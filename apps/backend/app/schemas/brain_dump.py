from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, Field

from app.schemas.task import EnergyLevel, TaskType


class BrainDumpRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    timezone: Optional[str] = Field(default=None, max_length=100)
    now: Optional[datetime] = None


class ProposedTask(BaseModel):
    title: str = Field(min_length=1, max_length=250)
    notes: Optional[str] = None
    task_type: TaskType = "flexible"
    due_at: Optional[datetime] = None
    scheduled_at: Optional[datetime] = None
    estimated_minutes: Optional[int] = Field(default=None, ge=1)
    energy_level: Optional[EnergyLevel] = None
    dependency_titles: List[str] = Field(default_factory=list)
    uncertainty: List[str] = Field(default_factory=list)


class BrainDumpResponse(BaseModel):
    provider: Literal["openai_compatible"]
    proposals: List[ProposedTask]
