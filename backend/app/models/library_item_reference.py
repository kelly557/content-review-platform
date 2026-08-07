"""LibraryItemReference: many-to-many link allowing one item to appear in
multiple libraries without duplicating storage. Used for cross-library imports.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class LibraryItemReference(Base):
    __tablename__ = "library_item_references"

    item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("library_items.id", ondelete="CASCADE"),
        primary_key=True,
    )
    library_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("libraries.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_library_item_references_library", "library_id"),
    )