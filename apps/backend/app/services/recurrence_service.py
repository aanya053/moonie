import calendar
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.recurring_rule import RecurringRule
from app.models.task import Task

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class RecurrenceService:
    @classmethod
    async def generate_due_instances(cls, session: AsyncSession, now: Optional[datetime] = None) -> int:
        """Generate at most one catch-up instance per due rule and advance it past now."""
        effective_now = now or utc_now()
        if effective_now.tzinfo is None:
            effective_now = effective_now.replace(tzinfo=timezone.utc)
        rules = (await session.scalars(
            select(RecurringRule).where(RecurringRule.enabled.is_(True)).where(RecurringRule.next_trigger_at <= effective_now)
        )).all()
        generated = 0
        for rule in rules:
            try:
                async with session.begin_nested():
                    generated += await cls._generate_due_rule(session, rule, effective_now)
            except Exception:
                # A malformed rule or failed insert is isolated with a savepoint;
                # other rules continue and this rule can retry on the next pass.
                continue
        return generated

    @classmethod
    async def _generate_due_rule(cls, session: AsyncSession, rule: RecurringRule, effective_now: datetime) -> int:
        active = (await session.scalars(
            select(Task.id).where(Task.recurring_rule_id == rule.id).where(Task.status.in_(["pending", "in_progress", "snoozed"]))
        )).first()
        generated = 0
        if active is None:
            await cls.spawn_next_instance(session, rule, from_time=effective_now)
            generated = 1
        # One catch-up occurrence maximum. Move the trigger into the future so repeated
        # scheduler passes cannot create a backlog or duplicate this occurrence.
        next_trigger = rule.next_trigger_at
        if next_trigger.tzinfo is None:
            next_trigger = next_trigger.replace(tzinfo=timezone.utc)
        while next_trigger <= effective_now:
            trigger = next_trigger
            days_list = json.loads(rule.days_of_week) if rule.days_of_week else None
            rule.next_trigger_at = cls.calculate_next_trigger(
                frequency=rule.frequency, interval_val=rule.interval_val, from_time=trigger,
                days_of_week=days_list, time_of_day=rule.time_of_day, anchor_day=rule.anchor_day,
            )
            next_trigger = rule.next_trigger_at
            if next_trigger.tzinfo is None:
                next_trigger = next_trigger.replace(tzinfo=timezone.utc)
        return generated
    @staticmethod
    def calculate_next_trigger(
        frequency: str,
        interval_val: int,
        from_time: datetime,
        days_of_week: Optional[List[int]] = None,
        time_of_day: Optional[str] = None,
        anchor_day: Optional[int] = None,
    ) -> datetime:
        """
        Calculates the next trigger timestamp based on rule criteria.
        """
        # Ensure UTC timezone
        if from_time.tzinfo is None:
            from_time = from_time.replace(tzinfo=timezone.utc)

        target = from_time

        if frequency == "daily":
            target = target + timedelta(days=interval_val)
        elif frequency == "weekdays":
            # Monday=0, Tuesday=1 ... Friday=4, Saturday=5, Sunday=6
            target = target + timedelta(days=1)
            while target.weekday() >= 5:  # Saturday or Sunday
                target = target + timedelta(days=1)
        elif frequency == "weekly":
            if days_of_week:
                sorted_days = sorted(days_of_week)
                current_day = target.weekday()

                # The week containing from_time is the anchor week. Interval 1
                # continues through later selected days in that week; larger
                # intervals begin in the corresponding future interval week.
                anchor_week = target - timedelta(days=current_day)
                if interval_val == 1:
                    next_day = next((day for day in sorted_days if day > current_day), None)
                    if next_day is not None:
                        target = anchor_week + timedelta(days=next_day)
                    else:
                        target = anchor_week + timedelta(weeks=1, days=sorted_days[0])
                else:
                    target = anchor_week + timedelta(
                        weeks=interval_val,
                        days=sorted_days[0],
                    )
            else:
                target = target + timedelta(weeks=interval_val)
        elif frequency == "monthly":
            # Preserve the original day-of-month anchor and clamp into the
            # target month when that day does not exist.
            original_day = anchor_day or target.day
            month_index = target.year * 12 + (target.month - 1) + interval_val
            target_year, target_month_index = divmod(month_index, 12)
            target_month = target_month_index + 1
            target_day = min(original_day, calendar.monthrange(target_year, target_month)[1])
            target = target.replace(
                year=target_year,
                month=target_month,
                day=target_day,
            )

        # Apply specific time_of_day if present
        if time_of_day and ":" in time_of_day:
            try:
                hour, minute = map(int, time_of_day.split(":"))
                target = target.replace(hour=hour, minute=minute, second=0, microsecond=0)
            except ValueError:
                pass

        return target

    @classmethod
    async def spawn_next_instance(
        cls,
        session: AsyncSession,
        rule: RecurringRule,
        from_time: Optional[datetime] = None
    ) -> Task:
        """
        Spawns a single task instance from the recurring template and advances the rule trigger.
        """
        now = from_time or utc_now()
        rule_trigger = rule.next_trigger_at
        if rule_trigger.tzinfo is None:
            rule_trigger = rule_trigger.replace(tzinfo=timezone.utc)
        trigger_time = rule_trigger if rule_trigger > now else now

        # Parse days_of_week
        days_list: Optional[List[int]] = None
        if rule.days_of_week:
            try:
                days_list = json.loads(rule.days_of_week)
            except Exception:
                days_list = None

        new_task = Task(
            title=rule.title,
            task_type="recurring",
            recurring_rule_id=rule.id,
            status="pending",
            scheduled_at=trigger_time,
            due_at=trigger_time,
        )
        session.add(new_task)

        # Advance next_trigger_at on template
        next_time = cls.calculate_next_trigger(
            frequency=rule.frequency,
            interval_val=rule.interval_val,
            from_time=trigger_time,
            days_of_week=days_list,
            time_of_day=rule.time_of_day,
            anchor_day=rule.anchor_day,
        )
        rule.next_trigger_at = next_time

        await session.flush()
        return new_task

    @classmethod
    async def on_recurring_task_resolved(cls, session: AsyncSession, task: Task) -> Optional[Task]:
        """
        When an active recurring task instance is marked completed or dropped,
        spawn the next instance just-in-time.
        """
        if not task.recurring_rule_id:
            return None

        stmt = select(RecurringRule).where(RecurringRule.id == task.recurring_rule_id)
        result = await session.execute(stmt)
        rule = result.scalar_one_or_none()
        if not rule:
            return None

        # Check if an active instance already exists to avoid duplicates
        active_stmt = (
            select(Task)
            .where(Task.recurring_rule_id == rule.id)
            .where(Task.status.in_(["pending", "in_progress"]))
            .where(Task.id != task.id)
        )
        active_res = await session.execute(active_stmt)
        if active_res.scalar_one_or_none() is not None:
            return None  # An active instance is already pending

        return await cls.spawn_next_instance(session, rule)
