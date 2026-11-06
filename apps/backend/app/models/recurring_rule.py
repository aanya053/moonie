import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.models.base import Base

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class RecurringRule(Base):
    __tablename__ = "recurring_rules"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    frequency = Column(String, nullable=False)  # 'daily', 'weekly', 'weekdays', 'monthly'
    interval_val = Column(Integer, nullable=False, default=1)
    anchor_day = Column(Integer, nullable=False, default=1)
    days_of_week = Column(String, nullable=True)  # JSON-encoded array, e.g. "[1, 3, 5]"
    time_of_day = Column(String, nullable=True)   # "HH:MM" e.g. "09:00"
    next_trigger_at = Column(DateTime(timezone=True), nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    # One-to-many relationship with spawned tasks
    tasks = relationship("Task", back_populates="recurring_rule", passive_deletes=True)
