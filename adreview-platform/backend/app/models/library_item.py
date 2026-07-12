"""LibraryItem: individual entry inside a Library.

For word libraries, `word` is set (storage fields NULL). For image libraries,
`storage_key`/`sha256`/etc are set and `word` is NULL. `is_deleted` enables a
30-day recycle bin before the nightly cleanup job physically removes the row
(and the image file on disk).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id


class LibraryItem(Base):
    __tablename__ = "library_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    library_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("libraries.id", ondelete="CASCADE"),
        nullable=False,
    )
    word: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    trigger: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    reply: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    storage_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    original_filename: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    mime_type: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    library: Mapped["Library"] = relationship(  # type: ignore[name-defined]
        back_populates="items",
    )

    __table_args__ = (
        CheckConstraint(
            "(word IS NOT NULL) OR (storage_key IS NOT NULL) OR (reply IS NOT NULL)",
            name="ck_library_items_kind_consistent",
        ),
        Index("ix_library_items_library_active", "library_id", "is_deleted"),
        Index("ix_library_items_word", "word"),
        Index("ix_library_items_sha", "sha256"),
    )