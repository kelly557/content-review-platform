"""LibraryGroup: user-defined category for libraries (词库/图库).

Replaces the legacy WordSetGroup / ImageSetGroup hardcoded enums. There are
no system groups anymore — every group is user-created, freely renamable, and
soft-deletable (as long as no library still references it).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class LibraryGroup(Base):
    __tablename__ = "library_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="100"
    )
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    libraries: Mapped[list["Library"]] = relationship(  # type: ignore[name-defined]
        back_populates="group",
    )

    __table_args__ = (
        Index("ix_library_groups_active_sort", "is_deleted", "sort_order"),
    )