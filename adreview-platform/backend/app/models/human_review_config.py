"""Human review config: per-service人机审核配置.

- is_enabled: 是否开启人机审核
- risk_levels: 哪些机审风险等级的结果会流入人审 (高/中/低/无)
- review_rule_id: 人审审核规则（流程模板）
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class RiskLevel(str, enum.Enum):
    HIGH = "高风险"
    MEDIUM = "中风险"
    LOW = "低风险"
    SENSITIVE = "敏感"
    NONE = "无风险"


class HumanReviewConfig(Base):
    __tablename__ = "human_review_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    service_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("services.code"), unique=True, index=True, nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    risk_levels: Mapped[str] = mapped_column(String(255), default="", nullable=False)  # 逗号分隔
    review_rule_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("workflow_templates.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )
