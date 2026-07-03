"""Custom image dataset model (黑/白名单 of image fingerprints / file references).

Stored as a parent ``ImageSet`` with child ``ImageSetItem`` rows pointing to
files on local storage. We do not compute perceptual hashes for the MVP — only
the original binary is kept.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, TypeDecorator

from app.db.session import Base


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class ImageSetGroup(str, enum.Enum):
    SENSITIVE = "敏感图"
    BRAND = "品牌"
    INDUSTRY = "行业"
    COMPLIANCE = "合规"
    INVENTORY = "清单"
    KEYWORD = "关键词"
    CUSTOM = "自定义"


class ImageSetAction(str, enum.Enum):
    BLOCK = "黑名单"
    ALLOW = "白名单"
    REVIEW = "需复审"
    TAG = "标签"


class ImageSetKind(str, enum.Enum):
    BLACKLIST = "黑名单"
    WHITELIST = "白名单"


class ImageSet(Base):
    __tablename__ = "image_sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    group: Mapped[ImageSetGroup] = mapped_column(
        Enum(ImageSetGroup), default=ImageSetGroup.KEYWORD, nullable=False, index=True
    )
    action: Mapped[ImageSetAction] = mapped_column(
        Enum(ImageSetAction), default=ImageSetAction.BLOCK, nullable=False, index=True
    )
    kind: Mapped[Optional[ImageSetKind]] = mapped_column(
        Enum(ImageSetKind), nullable=True, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ignored_services: Mapped[Any] = mapped_column(
        _JSONType, default=list, nullable=False
    )
    item_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=5000, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    items: Mapped[list["ImageSetItem"]] = relationship(
        back_populates="image_set",
        cascade="all, delete-orphan",
        order_by="ImageSetItem.id.desc()",
    )

    __table_args__ = (
        Index("ix_image_sets_group_action", "group", "action"),
        Index("ix_image_sets_action_active", "action", "is_active"),
    )


class ImageSetItem(Base):
    __tablename__ = "image_set_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    set_id: Mapped[int] = mapped_column(
        ForeignKey("image_sets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    image_set = relationship("ImageSet", back_populates="items")
