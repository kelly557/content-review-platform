"""Library: unified word/image/reply library (replaces word_sets + image_sets).

A library is one of type 'word', 'image', or 'reply'. Word and image libraries
carry a LibraryKind ('黑名单' / '白名单') describing match semantics; reply
libraries implicitly treat every entry as a hit-on-trigger rule and do not
carry a kind. Items (词条/图片/触发-回复 对) live in `library_items`; the legacy
Text-blob `words_text` and the legacy `image_set_items` table are superseded.
Custom_library_id on audit_points now points here.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
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
from app.core.id_generator import new_public_id


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class LibraryType(str, enum.Enum):
    WORD = "word"
    IMAGE = "image"
    REPLY = "reply"


class LibraryKind(str, enum.Enum):
    """Match semantics for word/image libraries.

    - BLACKLIST: hit on any entry rejects/forwards according to the rule.
    - WHITELIST: hit on any entry explicitly allows/short-circuits.

    Reply libraries (LibraryType.REPLY) implicitly treat every trigger as a
    hit-on-trigger rule and therefore do not carry a kind.
    """

    BLACKLIST = "黑名单"
    WHITELIST = "白名单"


class Library(Base):
    __tablename__ = "libraries"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    library_type: Mapped[LibraryType] = mapped_column(
        Enum(
            LibraryType,
            name="librarytype",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
    )
    # 仅 word / image 库必填；reply 库存 NULL（其规则即包含命中，不需要类型概念）
    kind: Mapped[Optional[LibraryKind]] = mapped_column(
        Enum(
            LibraryKind,
            name="librarykind",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=True,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    # 通用平台库标记: True = 平台预置共享库,仅超级管理员可见可改可删;
    # False = 用户自建个性化库 (默认)。
    is_platform: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True
    )
    ignored_services: Mapped[Any] = mapped_column(
        _JSONType, default=list, nullable=False
    )
    # 词库/图片库的有效时间区间；UTC。
    # - 两者都为 NULL → 永久生效
    # - 仅 effective_until 设了值 → 永久生效到该时刻
    # - 仅 effective_from 设了值 → 从该时刻起永久生效
    # - 两者都设了值 → [from, until] 闭区间生效（区间为空校验不允许）
    effective_from: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    effective_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    items: Mapped[list["LibraryItem"]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        order_by="LibraryItem.id.desc()",
    )
    back_audit_points: Mapped[list["AuditPoint"]] = relationship(
        "AuditPoint",
        secondary="audit_point_libraries",
        viewonly=True,
        lazy="selectin",
        overlaps="linked_libraries",
    )
    back_audit_items: Mapped[list["AuditItem"]] = relationship(
        "AuditItem",
        secondary="audit_item_libraries",
        viewonly=True,
        lazy="selectin",
        overlaps="linked_libraries",
    )

    __table_args__ = (
        Index(
            "ix_libraries_type_kind_active",
            "library_type",
            "kind",
            "is_deleted",
            "is_active",
        ),
        Index(
            "ix_libraries_effective_range",
            "effective_from",
            "effective_until",
        ),
    )
