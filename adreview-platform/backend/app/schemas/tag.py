"""Tag management schemas — flat multi-dimensional tag CRUD."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.tag import (
    TagCategory,
    TagDomain,
    TagSource,
    TagStatus,
)
from app.schemas.common import ORMBase


class TagBase(BaseModel):
    code: str = Field(min_length=1, max_length=96)
    name: str = Field(min_length=1, max_length=128)
    name_en: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    domain: TagDomain
    category: TagCategory
    jurisdictions: List[str] = Field(default_factory=list)
    industries: List[str] = Field(default_factory=list)
    channels: List[str] = Field(default_factory=list)
    knowledge_refs: List[str] = Field(default_factory=list)
    evidence_refs: List[str] = Field(default_factory=list)
    source: TagSource = TagSource.ENTERPRISE
    status: TagStatus = TagStatus.DRAFT

    @field_validator("jurisdictions", "industries", "channels")
    @classmethod
    def _strip_blanks(cls, v: List[str]) -> List[str]:
        return [s.strip() for s in v if s and s.strip()]


class TagCreate(TagBase):
    pass


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    name_en: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    domain: Optional[TagDomain] = None
    category: Optional[TagCategory] = None
    jurisdictions: Optional[List[str]] = None
    industries: Optional[List[str]] = None
    channels: Optional[List[str]] = None
    knowledge_refs: Optional[List[str]] = None
    evidence_refs: Optional[List[str]] = None
    status: Optional[TagStatus] = None


class TagOut(ORMBase):
    id: str
    code: str
    name: str
    name_en: Optional[str]
    description: Optional[str]
    domain: TagDomain
    category: TagCategory
    jurisdictions: List[str]
    industries: List[str]
    channels: List[str]
    knowledge_refs: List[str]
    evidence_refs: List[str]
    source: TagSource
    status: TagStatus
    version: int
    created_at: datetime
    updated_at: Optional[datetime]


class TagSummary(BaseModel):
    """Lightweight projection used by list pages."""

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)

    id: str
    code: str
    name: str
    name_en: Optional[str]
    domain: TagDomain
    category: TagCategory
    jurisdictions: List[str]
    industries: List[str]
    channels: List[str]
    source: TagSource
    status: TagStatus
    updated_at: Optional[datetime]