"""AuditItemLibrary: N:M join between audit_items and libraries.

Mirrors the legacy audit_point_libraries semantics but promoted to the
item level, so each audit item groups the libraries (word / image / reply)
that the rule wants to match against.

Rows must share a single ``library_type`` per audit item (互斥约束在
应用层 router 校验).

历史关联：原 ``audit_point_libraries`` 行由 alembic 迁移脚本
``20260721_promote_audit_point_libraries_to_item`` backfill 后标
DEPRECATED；router 仍可读但不再写入。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AuditItemLibrary(Base):
    __tablename__ = "audit_item_libraries"

    audit_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("audit_items.id", ondelete="CASCADE"),
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
        Index("ix_audit_item_libraries_lib", "library_id"),
    )
