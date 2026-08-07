"""API Key schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class ApiKeyCreate(BaseModel):
    tenant_id: int
    name: str = Field(min_length=1, max_length=128)
    description: Optional[str] = Field(default=None, max_length=512)
    scope: str = Field(default="read", pattern=r"^(read|write)$")
    expires_at: Optional[datetime] = None


class ApiKeyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=512)


class ApiKeyListParams(BaseModel):
    tenant_id: Optional[int] = None
    scope: Optional[str] = None
    status: Optional[str] = None  # active | expired | revoked
    q: Optional[str] = None


class ApiKeyOut(ORMBase):
    id: int
    tenant_id: int
    name: str
    description: Optional[str] = None
    key_prefix: str
    scope: str
    created_by: Optional[str] = None
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    created_at: datetime


class ApiKeyCreated(ApiKeyOut):
    # 仅创建/轮换时返回一次明文
    plaintext: str
