import json
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.models.recurring_rule import RecurringRule
from app.schemas.recurring_rule import RecurringRuleCreate, RecurringRuleUpdate, RecurringRuleRead
from app.services.recurrence_service import RecurrenceService

router = APIRouter(prefix="/recurring-rules", tags=["Recurrence"])

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

@router.post("", response_model=RecurringRuleRead, status_code=201)
async def create_recurring_rule(data: RecurringRuleCreate, session: AsyncSession = Depends(get_db)):
    start_time = data.start_at or utc_now()
    days_json = json.dumps(data.days_of_week) if data.days_of_week else None

    # Calculate initial next_trigger_at
    initial_trigger = RecurrenceService.calculate_next_trigger(
        frequency=data.frequency,
        interval_val=data.interval_val,
        from_time=start_time,
        days_of_week=data.days_of_week,
        time_of_day=data.time_of_day,
        anchor_day=start_time.day,
    )

    rule = RecurringRule(
        title=data.title,
        frequency=data.frequency,
        interval_val=data.interval_val,
        anchor_day=start_time.day,
        days_of_week=days_json,
        time_of_day=data.time_of_day,
        next_trigger_at=initial_trigger,
        enabled=data.enabled,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)

    # Spawn the very first task instance immediately so user sees today's task
    await RecurrenceService.spawn_next_instance(session, rule, from_time=start_time)
    await session.commit()
    await session.refresh(rule)

    return RecurringRuleRead.model_validate(rule)

@router.get("", response_model=List[RecurringRuleRead])
async def list_recurring_rules(session: AsyncSession = Depends(get_db)):
    stmt = select(RecurringRule).order_by(desc(RecurringRule.created_at))
    result = await session.execute(stmt)
    rules = result.scalars().all()
    return [RecurringRuleRead.model_validate(r) for r in rules]

@router.get("/{rule_id}", response_model=RecurringRuleRead)
async def get_recurring_rule(rule_id: str, session: AsyncSession = Depends(get_db)):
    stmt = select(RecurringRule).where(RecurringRule.id == rule_id)
    result = await session.execute(stmt)
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Recurring rule not found")
    return RecurringRuleRead.model_validate(rule)

@router.patch("/{rule_id}", response_model=RecurringRuleRead)
async def update_recurring_rule(rule_id: str, data: RecurringRuleUpdate, session: AsyncSession = Depends(get_db)):
    stmt = select(RecurringRule).where(RecurringRule.id == rule_id)
    result = await session.execute(stmt)
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Recurring rule not found")

    update_data = data.model_dump(exclude_unset=True)
    schedule_changed = any(
        field in update_data
        for field in ("frequency", "interval_val", "days_of_week", "time_of_day")
    )
    reference_time = rule.next_trigger_at
    if reference_time.tzinfo is None:
        reference_time = reference_time.replace(tzinfo=timezone.utc)

    if data.title is not None:
        rule.title = data.title
    if data.frequency is not None:
        rule.frequency = data.frequency
    if data.interval_val is not None:
        rule.interval_val = data.interval_val
    if "days_of_week" in update_data:
        rule.days_of_week = json.dumps(data.days_of_week) if data.days_of_week is not None else None
    if "time_of_day" in update_data:
        rule.time_of_day = data.time_of_day
    if "enabled" in update_data:
        rule.enabled = data.enabled

    if schedule_changed:
        days_list = json.loads(rule.days_of_week) if rule.days_of_week else None
        rule.next_trigger_at = RecurrenceService.calculate_next_trigger(
            frequency=rule.frequency,
            interval_val=rule.interval_val,
            from_time=reference_time,
            days_of_week=days_list,
            time_of_day=rule.time_of_day,
            anchor_day=rule.anchor_day,
        )

    await session.commit()
    await session.refresh(rule)
    return RecurringRuleRead.model_validate(rule)

@router.delete("/{rule_id}", status_code=204)
async def delete_recurring_rule(rule_id: str, session: AsyncSession = Depends(get_db)):
    stmt = select(RecurringRule).where(RecurringRule.id == rule_id)
    result = await session.execute(stmt)
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Recurring rule not found")

    await session.delete(rule)
    await session.commit()
    return None
