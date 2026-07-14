"""Schemas for the content-safety review knowledge base."""
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeDocumentVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    document_id: int
    version_no: int
    original_filename: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    sha256: Optional[str] = None
    source_url: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_json")
    created_by_id: Optional[int] = None
    created_at: datetime


class KnowledgeDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    code: str
    title: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    issued_at: Optional[datetime] = None
    status: str
    source_type: str
    source_url: Optional[str] = None
    current_version_id: Optional[int] = None
    current_version: Optional[KnowledgeDocumentVersionOut] = None
    owner_id: Optional[int] = None
    created_by_id: Optional[int] = None
    updated_by_id: Optional[int] = None
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class KnowledgeDocumentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    code: str
    title: str
    tags: List[str] = Field(default_factory=list)
    source_type: str
    issued_at: Optional[datetime] = None
    status: str
    current_version_id: Optional[int] = None
    current_version_no: Optional[int] = None
    current_version: Optional[KnowledgeDocumentVersionOut] = None
    owner_id: Optional[int] = None
    updated_at: Optional[datetime] = None
    created_at: datetime


class KnowledgeDocumentCreate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    tags: List[str] = Field(default_factory=list, max_length=64)
    issued_at: Optional[datetime] = None
    status: Optional[str] = None
    source_type: str = Field(
        default="manual",
        description="upload / url / manual",
    )
    source_url: Optional[str] = None


class KnowledgeDocumentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    issued_at: Optional[datetime] = None
    status: Optional[str] = None
    source_url: Optional[str] = None
