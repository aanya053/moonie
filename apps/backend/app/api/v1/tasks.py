from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.task import TaskCreate, TaskUpdate, TaskRead, SnoozeRequest
from app.schemas.dependency import DependencyCreate, DependencyRead
from app.services.task_service import TaskService
from app.services.dependency_service import DependencyService

router = APIRouter(prefix="/tasks", tags=["Tasks"])

async def enrich_task_read(session: AsyncSession, task) -> TaskRead:
    is_blocked = await DependencyService.is_task_blocked(session, task.id)
    prereqs = await DependencyService.get_prerequisite_ids(session, task.id)
    dependents = await DependencyService.get_dependent_ids(session, task.id)

    task_dict = {
        "id": task.id,
        "recurring_rule_id": task.recurring_rule_id,
        "title": task.title,
        "notes": task.notes,
        "status": task.status,
        "task_type": task.task_type,
        "due_at": task.due_at,
        "scheduled_at": task.scheduled_at,
        "snoozed_until": task.snoozed_until,
        "snooze_count": task.snooze_count,
        "estimated_minutes": task.estimated_minutes,
        "energy_level": task.energy_level,
        "completed_at": task.completed_at,
        "dropped_at": task.dropped_at,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "is_blocked": is_blocked,
        "prerequisite_ids": prereqs,
        "dependent_ids": dependents,
    }
    return TaskRead(**task_dict)

@router.post("", response_model=TaskRead, status_code=201)
async def create_task(data: TaskCreate, session: AsyncSession = Depends(get_db)):
    task = await TaskService.create_task(session, data)
    return await enrich_task_read(session, task)

@router.get("", response_model=List[TaskRead])
async def list_tasks(
    status: Optional[str] = Query(None, description="Filter by status ('pending', 'in_progress', etc.)"),
    task_type: Optional[str] = Query(None, description="Filter by task_type ('scheduled', 'deadline', etc.)"),
    include_completed: bool = Query(False, description="Include completed/dropped tasks"),
    session: AsyncSession = Depends(get_db),
):
    tasks = await TaskService.list_tasks(
        session, status=status, task_type=task_type, include_completed=include_completed
    )
    return [await enrich_task_read(session, t) for t in tasks]

@router.get("/{task_id}", response_model=TaskRead)
async def get_task(task_id: str, session: AsyncSession = Depends(get_db)):
    task = await TaskService.get_task(session, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return await enrich_task_read(session, task)

@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(task_id: str, data: TaskUpdate, session: AsyncSession = Depends(get_db)):
    task = await TaskService.update_task(session, task_id, data)
    return await enrich_task_read(session, task)

@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: str, session: AsyncSession = Depends(get_db)):
    await TaskService.delete_task(session, task_id)
    return None

# State Transitions
@router.post("/{task_id}/start", response_model=TaskRead)
async def start_task(task_id: str, session: AsyncSession = Depends(get_db)):
    task = await TaskService.start_task(session, task_id)
    return await enrich_task_read(session, task)

@router.post("/{task_id}/complete", response_model=TaskRead)
async def complete_task(task_id: str, session: AsyncSession = Depends(get_db)):
    task = await TaskService.complete_task(session, task_id)
    return await enrich_task_read(session, task)

@router.post("/{task_id}/drop", response_model=TaskRead)
async def drop_task(task_id: str, session: AsyncSession = Depends(get_db)):
    task = await TaskService.drop_task(session, task_id)
    return await enrich_task_read(session, task)

@router.post("/{task_id}/snooze", response_model=TaskRead)
async def snooze_task(task_id: str, data: SnoozeRequest, session: AsyncSession = Depends(get_db)):
    task = await TaskService.snooze_task(session, task_id, preset=data.preset, custom_until=data.custom_until)
    return await enrich_task_read(session, task)

@router.post("/{task_id}/reopen", response_model=TaskRead)
async def reopen_task(task_id: str, session: AsyncSession = Depends(get_db)):
    task = await TaskService.reopen_task(session, task_id)
    return await enrich_task_read(session, task)

# Dependency Endpoints
@router.post("/{task_id}/dependencies", response_model=DependencyRead, status_code=201)
async def add_dependency(task_id: str, data: DependencyCreate, session: AsyncSession = Depends(get_db)):
    dep = await TaskService.add_dependency(session, task_id, data.depends_on_task_id)
    return DependencyRead.model_validate(dep)

@router.delete("/{task_id}/dependencies/{depends_on_task_id}", status_code=204)
async def remove_dependency(task_id: str, depends_on_task_id: str, session: AsyncSession = Depends(get_db)):
    await TaskService.remove_dependency(session, task_id, depends_on_task_id)
    return None
