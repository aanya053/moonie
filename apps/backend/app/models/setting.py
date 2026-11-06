from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime
from app.models.base import Base

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
