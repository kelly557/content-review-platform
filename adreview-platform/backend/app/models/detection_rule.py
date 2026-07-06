"""Detection rule: per-service细分场景配置.

A DetectionRule belongs to a Service (via service_code) and describes
one细分标签 (e.g. pt_logotoSocialNetwork for ad_compliance_detection_pro).
Each rule has a 含义, 中/高风险阈值, a 细分检测范围 text, an enable switch,
and optional 关联 WordSet id for 自定义词库.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DetectionRule(Base):
    __tablename__ = "detection_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    service_code: Mapped[str] = mapped_column(String(64), ForeignKey("services.code"), index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    label_cn: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    medium_threshold: Mapped[float] = mapped_column(Float, default=60.0, nullable=False)
    high_threshold: Mapped[float] = mapped_column(Float, default=90.0, nullable=False)
    scope_text: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    custom_wordset_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("word_sets.id"), nullable=True)
    audit_point_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("audit_points.id"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    __table_args__ = (Index("ix_detection_rules_service_label", "service_code", "label", unique=True),)
