"""Tenant schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class TenantCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=128)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True


class TenantUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=128)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None


class TenantOut(ORMBase):
    id: int
    code: str
    name: str
    contact_email: Optional[str] = None
    is_active: bool
    created_at: datetime
    # 聚合字段（列表接口填充）
    key_count: Optional[int] = 0
    user_count: Optional[int] = 0
