"""AuditPoint: 审核点. Fine-grained detection config under an AuditItem.

Replaces the legacy DetectionRule with explicit item_id parentage.
Each point has thresholds, scope text, enable switch and optional library
associations (N:M via audit_point_libraries).

Legacy 1:1 columns (custom_wordset_id, custom_library_id, custom_reply_library_id)
are kept read-only for backward compatibility. New code only writes through
the `linked_libraries` relationship.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id

if TYPE_CHECKING:
    from app.models.audit_point_library import AuditPointLibrary
    from app.models.library import Library


class AuditPointRisk(str, enum.Enum):
    LOW = "低风险"
    MEDIUM = "中风险"
    HIGH = "高风险"


class AuditPoint(Base):
    __tablename__ = "audit_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    package_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("services.code"), nullable=False, index=True
    )
    item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("audit_items.id"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    label_cn: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    medium_threshold: Mapped[float] = mapped_column(Float, default=60.0, nullable=False)
    high_threshold: Mapped[float] = mapped_column(Float, default=90.0, nullable=False)
    scope_text: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    risk_level: Mapped[AuditPointRisk] = mapped_column(
        Enum(AuditPointRisk), default=AuditPointRisk.MEDIUM, nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    # ─── 旧列：保留只读，新代码不再写入 ───
    custom_wordset_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("word_sets.id"), nullable=True
    )
    custom_library_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("libraries.id"), nullable=True
    )
    custom_reply_library_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("libraries.id"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 解析来源 — 由用户上传的源文件产生的审核点（仅 kind=llm 或 kind=structured 解析时写入）
    # 删除源文件时 SET NULL（保留审核点）。NULL 表示人工新建或历史遗留数据。
    source_document_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("uploaded_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 源文件中引用的原文片段（仅 kind=llm 解析时有意义；structured 导入时为 NULL）
    source_quote: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 来源行号（结构化文件导入时记录 Excel/CSV 行号，便于追溯）
    source_line_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    # ─── N:M 关联：审核点 ↔ 库（互斥约束在应用层） ───
    linked_libraries: Mapped[list["Library"]] = relationship(
        "Library",
        secondary="audit_point_libraries",
        lazy="selectin",
        order_by="Library.id",
        overlaps="back_audit_points",
    )
    linked_library_links: Mapped[list["AuditPointLibrary"]] = relationship(
        "AuditPointLibrary",
        cascade="all, delete-orphan",
        lazy="selectin",
        overlaps="linked_libraries",
    )

    __table_args__ = (
        UniqueConstraint("package_code", "code", name="uq_audit_point_pkg_code"),
        Index("ix_audit_point_item", "item_id"),
    )