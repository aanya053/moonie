from typing import List, Set, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.task import Task, TaskDependency

class DependencyService:
    @staticmethod
    async def would_create_cycle(session: AsyncSession, task_id: str, depends_on_task_id: str) -> bool:
        """
        Validates if making `task_id` depend on `depends_on_task_id` would introduce a cycle.
        In our DAG: `depends_on_task_id` is a prerequisite for `task_id` (prereq -> blocked).
        A cycle would be created if `task_id` is already an ancestor/prerequisite of `depends_on_task_id`.
        """
        if task_id == depends_on_task_id:
            return True

        # Fetch all existing dependency edges to construct the graph in-memory
        stmt = select(TaskDependency.task_id, TaskDependency.depends_on_task_id)
        result = await session.execute(stmt)
        edges = result.all()

        # adj_prereqs[A] = list of tasks that A depends on
        adj_prereqs: Dict[str, List[str]] = {}
        for blocked, prereq in edges:
            adj_prereqs.setdefault(blocked, []).append(prereq)

        # Check if depends_on_task_id directly or indirectly depends on task_id
        visited: Set[str] = set()
        queue: List[str] = [depends_on_task_id]

        while queue:
            curr = queue.pop(0)
            if curr == task_id:
                return True  # Found path from depends_on_task_id back to task_id -> Cycle!
            if curr not in visited:
                visited.add(curr)
                for next_prereq in adj_prereqs.get(curr, []):
                    if next_prereq not in visited:
                        queue.append(next_prereq)

        return False

    @staticmethod
    async def is_task_blocked(session: AsyncSession, task_id: str) -> bool:
        """
        Returns True if `task_id` has any prerequisites that are NOT completed or dropped.
        """
        stmt = (
            select(Task.status)
            .join(TaskDependency, TaskDependency.depends_on_task_id == Task.id)
            .where(TaskDependency.task_id == task_id)
            .where(Task.status.not_in(["completed", "dropped"]))
        )
        result = await session.execute(stmt)
        uncompleted_prereqs = result.scalars().all()
        return len(uncompleted_prereqs) > 0

    @staticmethod
    async def get_prerequisite_ids(session: AsyncSession, task_id: str) -> List[str]:
        stmt = select(TaskDependency.depends_on_task_id).where(TaskDependency.task_id == task_id)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_dependent_ids(session: AsyncSession, task_id: str) -> List[str]:
        stmt = select(TaskDependency.task_id).where(TaskDependency.depends_on_task_id == task_id)
        result = await session.execute(stmt)
        return list(result.scalars().all())
