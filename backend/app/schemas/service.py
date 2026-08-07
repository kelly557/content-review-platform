"""Service schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.service import ServiceScope
from app.schemas.common import ORMBase


class ServiceOut(ORMBase):
    id: int
    code: str
    name: str
    scope: ServiceScope
    description: Optional[str]
    is_active: bool
    is_custom: bool
    category_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]


class ServiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    code: Optional[str] = Field(default=None, max_length=64)
    scope: ServiceScope = ServiceScope.BUSINESS
    description: Optional[str] = None
    category_id: Optional[int] = None


class ServiceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    scope: Optional[ServiceScope] = None
    is_active: Optional[bool] = None
    category_id: Optional[int] = None