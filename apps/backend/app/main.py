import asyncio
import os
from contextlib import asynccontextmanager
from sqlalchemy import inspect, text
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine
from app.models.base import Base
# Import all models to ensure metadata registration
import app.models.task  # noqa: F401
import app.models.recurring_rule  # noqa: F401
import app.models.setting  # noqa: F401
from app.api.v1.router import v1_router
from app.services.recurrence_service import RecurrenceService
from app.core.database import AsyncSessionLocal


async def migrate_additive_schema(database_engine=engine):
    try:
        async with database_engine.begin() as conn:
            def columns(sync_conn):
                return {column["name"] for column in inspect(sync_conn).get_columns("recurring_rules")}
            columns_now = await conn.run_sync(columns)
            if "enabled" not in columns_now:
                await conn.execute(text("ALTER TABLE recurring_rules ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT 1"))
    except Exception as error:
        raise RuntimeError("Moonie could not apply its additive database migration") from error


async def recurrence_scheduler(stop_event: asyncio.Event):
    interval = max(5, int(os.getenv("MOONIE_RECURRENCE_INTERVAL_SECONDS", "30")))
    while not stop_event.is_set():
        session = None
        try:
            async with AsyncSessionLocal() as session:
                await RecurrenceService.generate_due_instances(session)
                await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            # One failed pass is isolated; the next pass can safely retry.
            try:
                await session.rollback()
            except Exception:
                pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await migrate_additive_schema()
    stop_event = asyncio.Event()
    scheduler_task = asyncio.create_task(recurrence_scheduler(stop_event))
    yield
    # Shutdown
    stop_event.set()
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    await engine.dispose()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Moonie local-first deterministic task engine",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration for desktop frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router, prefix=settings.API_V1_PREFIX)

@app.get("/health", tags=["Health"])
async def health_check(request: Request):
    expected_token = os.getenv("MOONIE_HEALTH_TOKEN")
    if expected_token and request.headers.get("x-moonie-instance") != expected_token:
        return {"status": "unavailable"}
    return {
        "status": "ok",
        "service": "Moonie Task Engine",
        "version": "0.1.0",
    }
