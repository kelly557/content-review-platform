"""KnowledgeDocument — uploaded regulation / policy / law document.

A user picks tags + domain, uploads a PDF/TXT/MD, and the system:
1) stores the raw file under uploads/knowledge/<yyyy>/<mm>/<doc_id><ext>
2) extracts plain text via app.services.llm.text_extractor
3) calls MaaS to produce draft AuditItem / AuditPoint records
4) lets the user review & confirm; confirmed items land in the standard
   AuditItem / AuditPoint tables under a generated ``knowledge_<domain>_<scope>`` Service.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, Enum, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, TypeDecorator

from app.db.session import Base
from app.models.tag import TagDomain


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        from sqlalchemy.dialects.postgresql import JSONB

        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class KnowledgeScope(str, enum.Enum):
    LAW = "法律法规"
    REGULATION = "行政规定"
    INDUSTRY_RULE = "行业规范"
    INTERNAL_POLICY = "内部政策"


class KnowledgeDocumentStatus(str, enum.Enum):
    DRAFT = "draft"
    EXTRACTING = "extracting"
    REVIEW = "review"
    IMPORTED = "imported"
    FAILED = "failed"


class KnowledgeExtractionStatus(str, enum.Enum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    extracted_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    domain: Mapped[TagDomain] = mapped_column(Enum(TagDomain), nullable=False, index=True)
    scope: Mapped[KnowledgeScope] = mapped_column(
        Enum(KnowledgeScope), nullable=False, index=True
    )
    tag_ids: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)
    target_service_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    status: Mapped[KnowledgeDocumentStatus] = mapped_column(
        Enum(KnowledgeDocumentStatus),
        default=KnowledgeDocumentStatus.DRAFT,
        nullable=False,
        index=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    __table_args__ = (
        Index("ix_knowledge_doc_status_domain", "status", "domain"),
        Index("ix_knowledge_doc_checksum_owner", "checksum", "created_by_id"),
    )