"""Alert rule model — 异常检测规则配置（前端 anomalyThresholds 持久化）."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    metric: Mapped[str] = mapped_column(String(64), nullable=False)
    dimension: Mapped[str] = mapped_column(String(64), nullable=False, default="全局")
    algorithm: Mapped[str] = mapped_column(String(64), nullable=False, default="固定阈值")
    window_label: Mapped[str] = mapped_column(String(64), nullable=False, default="近 1 小时")
    # critical / warn: {operator, value, unit}
    critical: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    warn: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    extra_conditions: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="default")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
