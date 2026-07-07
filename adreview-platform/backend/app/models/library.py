"""Library: unified word/image library (replaces word_sets + image_sets).

A library is either of type 'word' or 'image' and belongs to exactly one
LibraryGroup (user-created). Items (词条/图片) live in `library_items`; the
legacy Text-blob `words_text` and the legacy `image_set_items` table are
superseded. Custom_library_id on audit_points now points here.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
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


class LibraryType(str, enum.Enum):
    WORD = "word"
    IMAGE = "image"


class Library(Base):
    __tablename__ = "libraries"

    id: Mapped[int] = mapped_column(primary_key=True)
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
    group_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("library_groups.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    group: Mapped["LibraryGroup"] = relationship(  # type: ignore[name-defined]
        back_populates="libraries",
    )
    items: Mapped[list["LibraryItem"]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        order_by="LibraryItem.id.desc()",
    )

    __table_args__ = (
        Index(
            "ix_libraries_type_group_active",
            "library_type",
            "group_id",
            "is_deleted",
            "is_active",
        ),
    )