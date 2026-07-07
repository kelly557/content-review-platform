"""Knowledge extraction result models.

One KnowledgeExtraction per (document, round). It owns N Items, each owning
M Points. Confirmed imports write through to AuditItem / AuditPoint and the
``imported_*_id`` columns are back-filled to the draft rows for traceability.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, TypeDecorator

from app.db.session import Base
from app.models.audit_point import AuditPointRisk
from app.models.knowledge_document import KnowledgeExtractionStatus


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        from sqlalchemy.dialects.postgresql import JSONB

        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class KnowledgeExtraction(Base):
    __tablename__ = "knowledge_extractions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    round_no: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    model: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    raw_response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[KnowledgeExtractionStatus] = mapped_column(
        Enum(KnowledgeExtractionStatus),
        default=KnowledgeExtractionStatus.PENDING,
        nullable=False,
        index=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_knowledge_extraction_doc", "document_id", "round_no"),)


class KnowledgeExtractionItem(Base):
    __tablename__ = "knowledge_extraction_items"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    extraction_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("knowledge_extractions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name_cn: Mapped[str] = mapped_column(String(64), nullable=False)
    aliases: Mapped[list] = mapped_column(_JSONType, default=list, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    selected: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    imported_item_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    item_draft_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("knowledge_extraction_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_kei_extraction_code", "extraction_id", "code"),)


class KnowledgeExtractionPoint(Base):
    __tablename__ = "knowledge_extraction_points"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    extraction_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("knowledge_extractions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_draft_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("knowledge_extraction_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    label_cn: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    judgment_logic: Mapped[dict] = mapped_column(_JSONType, default=dict, nullable=False)
    judgment_rule: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    judgment_basis: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_level: Mapped[AuditPointRisk] = mapped_column(
        Enum(AuditPointRisk), default=AuditPointRisk.MEDIUM, nullable=False
    )
    medium_threshold: Mapped[float] = mapped_column(Float, default=60.0, nullable=False)
    high_threshold: Mapped[float] = mapped_column(Float, default=90.0, nullable=False)
    scope_text: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    selected: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    imported_point_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_kep_extraction_code", "extraction_id", "code"),)