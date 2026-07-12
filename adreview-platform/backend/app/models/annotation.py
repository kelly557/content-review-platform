"""Annotation models: comments + canvas-shape highlights bound to a material version."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id


class Annotation(Base):
    """A pin/comment anchored to a (version, optional page/frame/timestamp) location."""

    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    material_version_id: Mapped[int] = mapped_column(
        ForeignKey("material_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    # Location binding: at least one of page/frame/time should be set for media.
    page: Mapped[Optional[int]] = mapped_column(Integer)  # PDF page
    frame: Mapped[Optional[int]] = mapped_column(Integer)  # video frame index
    timestamp_ms: Mapped[Optional[int]] = mapped_column(Integer)  # video/audio millisecond
    x: Mapped[Optional[float]] = mapped_column(Float)  # normalized 0..1
    y: Mapped[Optional[float]] = mapped_column(Float)
    w: Mapped[Optional[float]] = mapped_column(Float)
    h: Mapped[Optional[float]] = mapped_column(Float)

    # Free-form shape data (polygon / path) for canvas drawings.
    shape: Mapped[Optional[dict]] = mapped_column(JSONB)
    quote: Mapped[Optional[str]] = mapped_column(Text)  # text excerpt being annotated
    body: Mapped[str] = mapped_column(Text, nullable=False)

    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("annotations.id"))
    resolved: Mapped[bool] = mapped_column(default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    replies: Mapped[list["Annotation"]] = relationship("Annotation")


class ReviewComment(Base):
    """Stage-level comment (decision explanation, free-form remark)."""

    __tablename__ = "review_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    task_id: Mapped[int] = mapped_column(
        ForeignKey("review_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task = relationship("ReviewTask", back_populates="comments")
