"""DispositionRule (Phase B).

处置规则 = 命中的素材如何处理（升级人审 / 拒绝 / 脱敏 / 抽样比例 / 8-cell 矩阵）。

Phase A 之前整套塞在 strategies.definition.human_review + trigger.override_human_review
+ material_package.override_human_review。Phase B 起抽到 disposition_rules 表：

- strategies.disposition_rule_id      → 策略默认处置
- (PR B5) triggers.override_disposition_id    → 触发器级 inline 覆盖
- (PR B5) material_packages.override_disposition_id → 任务包级 inline 覆盖

本期 (PR B1) 只建表与内置默认；不改 service、不动父表字段。
PR B5 才会做 RENAME COLUMN 与强类型 FK 绑定。
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id


class DispositionRule(Base):
    __tablename__ = "disposition_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)

    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    risk_levels: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=list
    )
    sensitive_levels: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=list
    )

    review_rule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("workflow_templates.id", ondelete="SET NULL"), nullable=True
    )
    sample_ratio: Mapped[Optional[float]] = mapped_column(
        Numeric(5, 2), nullable=True, default=100.0
    )
    auto_action_overrides: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_editable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    locked_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    locked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    strategies: Mapped[list["Strategy"]] = relationship(
        back_populates="disposition_rule", foreign_keys="Strategy.disposition_rule_id"
    )

    __table_args__ = (UniqueConstraint("code", name="uq_disposition_rules_code"),)
