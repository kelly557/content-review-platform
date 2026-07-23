"""PageGuide — server-side override for the frontend prototype guide text.

Each row represents a single frontend route (e.g. ``/strategies/:id/edit``)
whose prototype-guide markdown has been customized by a user. When the
frontend ``PageGuideButton`` opens, it first loads the static fallback from
``frontend/src/lib/pageGuides.tsx``; if a row exists here for the current
path, the server version wins.

This is intentionally a flat string store:
- The granularity of a "save" is the whole page (one Markdown blob).
- The frontend ``sectionsToDraft`` / ``draftToSections`` helpers already
  handle the round-trip between ``PageGuide`` and a flat Markdown string,
  so the storage shape mirrors the wire shape.

Note: We do not link this table to ``seed.py`` / ``init_db.py`` (per
``CLAUDE.md``). Rows are created lazily by user edits only.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PageGuide(Base):
    __tablename__ = "page_guide"

    path: Mapped[str] = mapped_column(String(255), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    markdown_md: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by_id: Mapped[Optional[int]] = mapped_column(
            ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_page_guide_updated_at", "updated_at"),
    )
