"""Tag management model — flat multi-dimensional tag (metadata-only).

P0 scope: the Tag record itself is the only persistent entity. The
hit-engine tables (TagHitRule / TagHit / TagNegativeSample) and the
risk/action/stats columns (which only made sense with an execution
engine) have all been removed.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    DateTime,
    Enum,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, TypeDecorator

from app.db.session import Base


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        from sqlalchemy.dialects.postgresql import JSONB

        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class TagDomain(str, enum.Enum):
    POLITICS = "politics"
    PORN = "porn"
    VIOLENCE = "violence"
    ADS_LAW = "ads_law"
    MEDICAL = "medical"
    FINANCE = "finance"
    MINOR = "minor"
    PRIVACY = "privacy"
    IP = "ip"
    GAMBLING = "gambling"
    FRAUD = "fraud"
    CUSTOM = "custom"


class TagCategory(str, enum.Enum):
    FIGURE = "figure"
    EVENT = "event"
    ORGANIZATION = "organization"
    SYMBOL = "symbol"
    CLAIM = "claim"
    SLOGAN = "slogan"
    SCENE = "scene"
    PRODUCT = "product"
    PRICE = "price"
    ABSOLUTE_TERM = "absolute_term"
    CREDENTIAL = "credential"
    CUSTOM = "custom"


class TagStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    DEPRECATED = "deprecated"


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    code: Mapped[str] = mapped_column(String(96), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    name_en: Mapped[Optional[str]] = mapped_column(String(128))
    description: Mapped[Optional[str]] = mapped_column(Text)

    domain: Mapped[TagDomain] = mapped_column(Enum(TagDomain), nullable=False, index=True)
    category: Mapped[TagCategory] = mapped_column(Enum(TagCategory), nullable=False, index=True)
    jurisdictions: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)
    industries: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)
    channels: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)

    knowledge_refs: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)
    evidence_refs: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)

    status: Mapped[TagStatus] = mapped_column(
        Enum(TagStatus), default=TagStatus.DRAFT, nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True, index=True
    )

    __table_args__ = (
        Index("ix_tag_domain_category", "domain", "category"),
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None