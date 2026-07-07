"""Knowledge document schemas."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.knowledge_document import (
    KnowledgeDocumentStatus,
    KnowledgeScope,
)
from app.models.tag import TagDomain
from app.schemas.common import ORMBase


class KnowledgeDocumentOut(ORMBase):
    id: str
    title: str
    original_filename: str
    mime_type: str
    file_size: int
    domain: TagDomain
    scope: KnowledgeScope
    tag_ids: List[str] = Field(default_factory=list)
    target_service_code: Optional[str] = None
    status: KnowledgeDocumentStatus
    error_message: Optional[str] = None
    created_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class KnowledgeDocumentSummary(BaseModel):
    """Lightweight projection for the document list page."""

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)

    id: str
    title: str
    original_filename: str
    mime_type: str
    file_size: int
    domain: TagDomain
    scope: KnowledgeScope
    tag_ids: List[str] = Field(default_factory=list)
    status: KnowledgeDocumentStatus
    created_at: datetime
    updated_at: Optional[datetime] = None


class KnowledgeDocumentListResponse(BaseModel):
    items: List[KnowledgeDocumentSummary]
    total: int
    page: int
    size: int


class KnowledgeExtractionSummary(BaseModel):
    """Embedded inside document detail."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    round_no: int
    model: Optional[str] = None
    prompt_tokens: int
    completion_tokens: int
    status: str
    error_message: Optional[str] = None
    chunk_count: int
    created_at: datetime


class KnowledgeDocumentDetail(KnowledgeDocumentOut):
    """Document detail with extraction summaries."""

    extractions: List[KnowledgeExtractionSummary] = Field(default_factory=list)


class KnowledgeExtractionTriggerRequest(BaseModel):
    """Optional overrides when triggering extraction."""

    force: bool = Field(default=False, description="允许对已 imported 的文档重新抽取")