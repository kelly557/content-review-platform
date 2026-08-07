"""AuditPointLibrary: N:M join between audit_points and libraries.

Each audit point can be associated with 1..N libraries of a SINGLE
library_type (互斥约束由应用层在 router 校验). The legacy 1:1 FK columns
on audit_points (custom_wordset_id, custom_library_id, custom_reply_library_id)
are kept for backward compatibility but不再写入.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AuditPointLibrary(Base):
    __tablename__ = "audit_point_libraries"

    audit_point_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("audit_points.id", ondelete="CASCADE"),
        primary_key=True,
    )
    library_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("libraries.id", ondelete="CASCADE"),
        primary_key=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_audit_point_libraries_lib", "library_id"),
    )
