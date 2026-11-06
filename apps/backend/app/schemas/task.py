from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field

TaskStatus = Literal["pending", "in_progress", "snoozed", "completed", "dropped"]
TaskType = Literal["scheduled", "deadline", "recurring", "flexible"]
EnergyLevel = Literal["low", "medium", "high"]
SnoozePreset = Literal["later_today", "tomorrow_morning", "this_weekend", "next_week", "custom"]

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=250, description="Actionable task label")
    notes: Optional[str] = Field(default=None, description="Detailed notes, links, or context")
    task_type: TaskType = Field(default="flexible", description="Scheduling classification")
    due_at: Optional[datetime] = Field(default=None, description="Soft deadline timestamp")
    scheduled_at: Optional[datetime] = Field(default=None, description="Fixed calendar appointment timestamp")
    estimated_minutes: Optional[int] = Field(default=None, ge=1, description="Estimated duration in minutes")
    energy_level: Optional[EnergyLevel] = Field(default=None, description="Cognitive effort required")
    recurring_rule_id: Optional[str] = Field(default=None, description="Parent recurring template ID")
    depends_on_task_ids: Optional[List[str]] = Field(default=None, description="List of prerequisite task IDs")

class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=250)
    notes: Optional[str] = None
    task_type: Optional[TaskType] = None
    due_at: Optional[datetime] = None
    scheduled_at: Optional[datetime] = None
    estimated_minutes: Optional[int] = Field(default=None, ge=1)
    energy_level: Optional[EnergyLevel] = None

class SnoozeRequest(BaseModel):
    preset: SnoozePreset = Field(default="tomorrow_morning", description="Preset snooze duration")
    custom_until: Optional[datetime] = Field(default=None, description="Specific wake-up timestamp if preset='custom'")

class TaskRead(BaseModel):
    id: str
    recurring_rule_id: Optional[str] = None
    title: str
    notes: Optional[str] = None
    status: str
    task_type: str
    due_at: Optional[datetime] = None
    scheduled_at: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    snooze_count: int
    estimated_minutes: Optional[int] = None
    energy_level: Optional[str] = None
    completed_at: Optional[datetime] = None
    dropped_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    # Derived properties
    is_blocked: bool = Field(default=False, description="True if any uncompleted prerequisite dependencies exist")
    prerequisite_ids: List[str] = Field(default_factory=list, description="IDs of tasks this task depends on")
    dependent_ids: List[str] = Field(default_factory=list, description="IDs of tasks blocked by this task")

    class Config:
        from_attributes = True
