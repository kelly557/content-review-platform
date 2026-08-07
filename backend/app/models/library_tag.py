"""LibraryTag: many-to-many binding between Library and Tag (level 1/2 only).

A library can optionally bind one top-level (level 1) or mid-level (level 2)
tag from the existing ``tags`` table. The binding is used at:

  - library create / update (optional)
  - local word matcher hit label (prefix with the bound tag's full path)

We use an explicit M2M table (rather than a single FK column) so that:
  1. Library keeps zero coupling to the tag table at the model level
     (other library types like image, which currently don't bind tags, share
     the same Library model).
  2. Future migration to "one library can bind multiple tags" only adds a row,
     no schema change required.

Service-layer enforcement (see ``_resolve_library_tag`` in
``app/api/v1/libraries.py``) rejects level=3 (leaf) bindings because
leaf tags are reserved for model binding semantics.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.library import Library
    from app.models.tag import Tag


class LibraryTag(Base):
    __tablename__ = "library_tags"

    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.now(),
        nullable=False,
    )

    library: Mapped["Library"] = relationship(
        "Library",
        viewonly=True,
    )
    tag: Mapped["Tag"] = relationship(
        "Tag",
        viewonly=True,
    )

    __table_args__ = (
        Index("ix_library_tags_tag_id", "tag_id"),
    )
