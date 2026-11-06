from datetime import datetime, timedelta, timezone
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, desc, or_, select
from fastapi import HTTPException

from app.models.task import Task, TaskDependency
from app.schemas.task import TaskCreate, TaskUpdate, SnoozePreset
from app.services.dependency_service import DependencyService
from app.services.recurrence_service import RecurrenceService

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class TaskService:
    @staticmethod
    def calculate_snooze_time(preset: SnoozePreset, custom_until: Optional[datetime] = None) -> datetime:
        now = utc_now()
        if preset == "custom":
            if not custom_until:
                raise HTTPException(status_code=400, detail="custom_until timestamp required for custom preset")
            return custom_until

        if preset == "later_today":
            return now + timedelta(hours=3)
        elif preset == "tomorrow_morning":
            tomorrow = now + timedelta(days=1)
            return tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)
        elif preset == "this_weekend":
            # Days until Saturday (weekday 5)
            days_until_sat = (5 - now.weekday()) % 7
            if days_until_sat == 0:
                days_until_sat = 7
            saturday = now + timedelta(days=days_until_sat)
            return saturday.replace(hour=10, minute=0, second=0, microsecond=0)
        elif preset == "next_week":
            # Days until next Monday (weekday 0)
            days_until_mon = (7 - now.weekday()) % 7
            if days_until_mon == 0:
                days_until_mon = 7
            monday = now + timedelta(days=days_until_mon)
            return monday.replace(hour=9, minute=0, second=0, microsecond=0)

        return now + timedelta(days=1)

    @classmethod
    async def create_task(cls, session: AsyncSession, data: TaskCreate) -> Task:
        try:
            task = Task(
                title=data.title,
                notes=data.notes,
                task_type=data.task_type,
                due_at=data.due_at,
                scheduled_at=data.scheduled_at,
                estimated_minutes=data.estimated_minutes,
                energy_level=data.energy_level,
                recurring_rule_id=data.recurring_rule_id,
                status="pending",
            )
            session.add(task)
            await session.flush()

            # Add initial dependencies within this task creation transaction.
            if data.depends_on_task_ids:
                for prereq_id in data.depends_on_task_ids:
                    await cls.add_dependency(session, task.id, prereq_id, commit=False)

            await session.commit()
            await session.refresh(task)
            return task
        except Exception:
            await session.rollback()
            raise

    @classmethod
    async def get_task(cls, session: AsyncSession, task_id: str) -> Optional[Task]:
        stmt = select(Task).where(Task.id == task_id)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    @classmethod
    async def list_tasks(
        cls,
        session: AsyncSession,
        status: Optional[str] = None,
        task_type: Optional[str] = None,
        include_completed: bool = False,
        now: Optional[datetime] = None,
    ) -> List[Task]:
        stmt = select(Task)
        if status:
            stmt = stmt.where(Task.status == status)
        elif not include_completed:
            eligible_snooze_time = now or utc_now()
            stmt = stmt.where(
                or_(
                    Task.status.in_(["pending", "in_progress"]),
                    and_(
                        Task.status == "snoozed",
                        or_(
                            Task.snoozed_until.is_(None),
                            Task.snoozed_until <= eligible_snooze_time,
                        ),
                    ),
                )
            )

        if task_type:
            stmt = stmt.where(Task.task_type == task_type)

        stmt = stmt.order_by(desc(Task.created_at))
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @classmethod
    async def update_task(cls, session: AsyncSession, task_id: str, data: TaskUpdate) -> Task:
        task = await cls.get_task(session, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        update_dict = data.model_dump(exclude_unset=True)
        for key, value in update_dict.items():
            setattr(task, key, value)

        await session.commit()
        await session.refresh(task)
        return task

    @classmethod
    async def delete_task(cls, session: AsyncSession, task_id: str) -> bool:
        task = await cls.get_task(session, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        await session.delete(task)
        await session.commit()
        return True

    # State Transitions
    @classmethod
    async def start_task(cls, session: AsyncSession, task_id: str) -> Task:
        task = await cls.get_task(session, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        if task.status == "dropped":
            raise HTTPException(status_code=400, detail="Cannot start a dropped task.")

        # Check if task is blocked
        if await DependencyService.is_task_blocked(session, task_id):
            raise HTTPException(
                status_code=400,
                detail="This task is waiting on prerequisites. Complete those first!"
            )

        task.status = "in_progress"
        await session.commit()
        await session.refresh(task)
        return task

    @classmethod
    async def complete_task(cls, session: AsyncSession, task_id: str) -> Task:
        task = await cls.get_task(session, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        task.status = "completed"
        task.completed_at = utc_now()

        # Handle recurring task progression
        await RecurrenceService.on_recurring_task_resolved(session, task)

        await session.commit()
        await session.refresh(task)
        return task

    @classmethod
    async def drop_task(cls, session: AsyncSession, task_id: str) -> Task:
        task = await cls.get_task(session, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        task.status = "dropped"
        task.dropped_at = utc_now()

        # Handle recurring task progression peacefully
        await RecurrenceService.on_recurring_task_resolved(session, task)

        await session.commit()
        await session.refresh(task)
        return task

    @classmethod
    async def snooze_task(
        cls,
        session: AsyncSession,
        task_id: str,
        preset: SnoozePreset,
        custom_until: Optional[datetime] = None
    ) -> Task:
        task = await cls.get_task(session, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        if task.status == "completed":
            raise HTTPException(status_code=400, detail="Cannot snooze a completed task.")

        snooze_time = cls.calculate_snooze_time(preset, custom_until)
        task.status = "snoozed"
        task.snoozed_until = snooze_time
        task.snooze_count += 1

        await session.commit()
        await session.refresh(task)
        return task

    @classmethod
    async def reopen_task(cls, session: AsyncSession, task_id: str) -> Task:
        task = await cls.get_task(session, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        task.status = "pending"
        task.snoozed_until = None
        task.completed_at = None
        task.dropped_at = None

        await session.commit()
        await session.refresh(task)
        return task

    # Dependency Management
    @classmethod
    async def add_dependency(
        cls,
        session: AsyncSession,
        task_id: str,
        depends_on_task_id: str,
        commit: bool = True,
    ) -> TaskDependency:
        if task_id == depends_on_task_id:
            raise HTTPException(status_code=400, detail="A task cannot depend on itself.")

        # Ensure both tasks exist
        t1 = await cls.get_task(session, task_id)
        t2 = await cls.get_task(session, depends_on_task_id)
        if not t1 or not t2:
            raise HTTPException(status_code=404, detail="One or both tasks do not exist.")

        # Cycle check
        if await DependencyService.would_create_cycle(session, task_id, depends_on_task_id):
            raise HTTPException(
                status_code=400,
                detail="Cannot add dependency: this would create a circular loop!"
            )

        # Check existing
        existing_stmt = select(TaskDependency).where(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_task_id == depends_on_task_id
        )
        existing = await session.execute(existing_stmt)
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="This dependency already exists.")

        dep = TaskDependency(task_id=task_id, depends_on_task_id=depends_on_task_id)
        session.add(dep)
        if commit:
            await session.commit()
            await session.refresh(dep)
        else:
            await session.flush()
        return dep

    @classmethod
    async def remove_dependency(cls, session: AsyncSession, task_id: str, depends_on_task_id: str) -> bool:
        stmt = select(TaskDependency).where(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_task_id == depends_on_task_id
        )
        result = await session.execute(stmt)
        dep = result.scalar_one_or_none()
        if not dep:
            raise HTTPException(status_code=404, detail="Dependency not found.")

        await session.delete(dep)
        await session.commit()
        return True
