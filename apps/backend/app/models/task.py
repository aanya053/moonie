import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, UniqueConstraint, CheckConstraint, Index
from sqlalchemy.orm import relationship
from app.models.base import Base

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class TaskDependency(Base):
    __tablename__ = "task_dependencies"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    depends_on_task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("task_id", "depends_on_task_id", name="uq_task_dependency_pair"),
        CheckConstraint("task_id != depends_on_task_id", name="ck_no_self_dependency"),
        Index("idx_deps_task_id", "task_id"),
        Index("idx_deps_depends_on", "depends_on_task_id"),
    )

    # Relationships
    task = relationship("Task", foreign_keys=[task_id], back_populates="prerequisite_links")
    depends_on = relationship("Task", foreign_keys=[depends_on_task_id], back_populates="dependent_links")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    recurring_rule_id = Column(String, ForeignKey("recurring_rules.id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=False)
    notes = Column(String, nullable=True)
    
    # States: 'pending', 'in_progress', 'snoozed', 'completed', 'dropped'
    status = Column(String, default="pending", nullable=False)
    
    # Types: 'scheduled', 'deadline', 'recurring', 'flexible'
    task_type = Column(String, default="flexible", nullable=False)
    
    due_at = Column(DateTime(timezone=True), nullable=True)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    snoozed_until = Column(DateTime(timezone=True), nullable=True)
    snooze_count = Column(Integer, default=0, nullable=False)
    estimated_minutes = Column(Integer, nullable=True)
    energy_level = Column(String, nullable=True)  # 'low', 'medium', 'high'
    
    completed_at = Column(DateTime(timezone=True), nullable=True)
    dropped_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        Index("idx_tasks_status", "status"),
        Index("idx_tasks_due_at", "due_at"),
        Index("idx_tasks_scheduled_at", "scheduled_at"),
        Index("idx_tasks_snoozed_until", "snoozed_until"),
    )

    # Relationships
    recurring_rule = relationship("RecurringRule", back_populates="tasks")
    
    # Dependencies where THIS task is the one blocked (prerequisites that must finish first)
    prerequisite_links = relationship(
        "TaskDependency",
        foreign_keys=[TaskDependency.task_id],
        back_populates="task",
        cascade="all, delete-orphan",
    )
    
    # Dependencies where THIS task is the blocker for other tasks
    dependent_links = relationship(
        "TaskDependency",
        foreign_keys=[TaskDependency.depends_on_task_id],
        back_populates="depends_on",
        cascade="all, delete-orphan",
    )
