from datetime import datetime
from pydantic import BaseModel, Field

class DependencyCreate(BaseModel):
    depends_on_task_id: str = Field(description="ID of the prerequisite task that must be completed first")

class DependencyRead(BaseModel):
    id: str
    task_id: str
    depends_on_task_id: str
    created_at: datetime

    class Config:
        from_attributes = True
