from fastapi import APIRouter
from app.api.v1.tasks import router as tasks_router
from app.api.v1.recurrence import router as recurrence_router
from app.api.v1.brain_dump import router as brain_dump_router

v1_router = APIRouter()
v1_router.include_router(tasks_router)
v1_router.include_router(recurrence_router)
v1_router.include_router(brain_dump_router)
