import json
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, field_validator

RecurrenceFrequency = Literal["daily", "weekly", "weekdays", "monthly"]

class RecurringRuleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200, description="Title for recurring tasks")
    frequency: RecurrenceFrequency
    interval_val: int = Field(default=1, ge=1, description="Interval multiplier e.g. every 2 weeks")
    days_of_week: Optional[List[int]] = Field(default=None, description="Days of week using Monday=0 through Sunday=6")
    time_of_day: Optional[str] = Field(default=None, description="HH:MM time format, e.g. '09:00'")
    start_at: Optional[datetime] = Field(default=None, description="When the first instance should start")
    enabled: bool = True

    @field_validator("days_of_week")
    @classmethod
    def validate_days_of_week(cls, value):
        if value is None:
            return value
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("days_of_week values must be between 0 (Monday) and 6 (Sunday)")
        if len(set(value)) != len(value):
            raise ValueError("days_of_week values must be unique")
        return sorted(value)

class RecurringRuleUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    frequency: Optional[RecurrenceFrequency] = None
    interval_val: Optional[int] = Field(default=None, ge=1)
    days_of_week: Optional[List[int]] = None
    time_of_day: Optional[str] = None
    enabled: Optional[bool] = None

    @field_validator("days_of_week")
    @classmethod
    def validate_days_of_week(cls, value):
        if value is None:
            return value
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("days_of_week values must be between 0 (Monday) and 6 (Sunday)")
        if len(set(value)) != len(value):
            raise ValueError("days_of_week values must be unique")
        return sorted(value)

class RecurringRuleRead(BaseModel):
    id: str
    title: str
    frequency: str
    interval_val: int
    days_of_week: Optional[List[int]] = None
    time_of_day: Optional[str] = None
    next_trigger_at: datetime
    created_at: datetime
    enabled: bool = True

    @field_validator("days_of_week", mode="before")
    def parse_days_of_week(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v

    class Config:
        from_attributes = True
