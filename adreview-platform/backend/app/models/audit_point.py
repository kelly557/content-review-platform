"""AuditPoint: 审核点. Fine-grained detection config under an AuditItem.

Replaces the legacy DetectionRule with explicit item_id parentage.
Each point has thresholds, scope text, enable switch and optional wordset link.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
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
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AuditPointRisk(str, enum.Enum):
    LOW = "低风险"
    MEDIUM = "中风险"
    HIGH = "高风险"


class AuditPoint(Base):
    __tablename__ = "audit_points"

    id: Mapped[int] = mapped_column(primary_key=True)
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
    custom_wordset_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("word_sets.id"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("package_code", "code", name="uq_audit_point_pkg_code"),
        Index("ix_audit_point_item", "item_id"),
    )