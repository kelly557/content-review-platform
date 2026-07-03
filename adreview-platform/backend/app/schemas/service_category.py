"""ServiceCategory schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class ServiceCategoryOut(ORMBase):
    id: int
    code: str
    name: str
    description: Optional[str]
    is_system: bool
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]


class ServiceCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    code: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = None
    sort_order: int = Field(default=0, ge=0)


class ServiceCategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    sort_order: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None
