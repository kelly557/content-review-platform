"""AuditItem schemas."""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class AuditItemOut(ORMBase):
    id: int
    package_code: str
    code: str
    name_cn: str
    aliases: list[Any] = Field(default_factory=list)
    description: Optional[str] = None
    sort_order: int = 0
    is_enabled: bool = True
    point_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None


class AuditItemCreate(BaseModel):
    name_cn: str = Field(min_length=1, max_length=64)
    aliases: list[Any] = Field(default_factory=list)
    description: Optional[str] = None
    sort_order: int = 0
    is_enabled: bool = True


class AuditItemUpdate(BaseModel):
    name_cn: Optional[str] = Field(default=None, min_length=1, max_length=64)
    aliases: Optional[list[Any]] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_enabled: Optional[bool] = None


class ItemSuggestion(BaseModel):
    item_id: int
    item_code: str
    item_name_cn: str
    score: float
    matched_aliases: list[str] = Field(default_factory=list)
    matched_terms: list[str] = Field(default_factory=list)


class SuggestResponse(BaseModel):
    matches: list[ItemSuggestion] = Field(default_factory=list)
    mock: bool = True
    engine: str = "mock-v1"