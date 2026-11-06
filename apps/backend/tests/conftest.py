from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api.v1.tasks import get_db
from app.main import app as moonie_app
from app.models.base import Base
import app.models.recurring_rule  # noqa: F401
import app.models.setting  # noqa: F401
import app.models.task  # noqa: F401


@pytest_asyncio.fixture
async def test_engine(tmp_path) -> AsyncIterator[AsyncEngine]:
    database_path = tmp_path / "moonie-test.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine.sync_engine, "connect")
    def configure_test_sqlite(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute("PRAGMA journal_mode = WAL;")
        cursor.close()

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def client(test_engine: AsyncEngine) -> AsyncIterator[AsyncClient]:
    session_factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
            finally:
                await session.close()

    moonie_app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=moonie_app)

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as test_client:
            yield test_client
    finally:
        moonie_app.dependency_overrides.clear()
