"""Strategy configuration model.

Represents a review/risk strategy. The "default" strategy is a singleton that
takes effect when no other strategy is active.

注：原 priority 字段已删除（v11 清理过度设计）。该字段从未被 runtime 实际使用，
且 index `ix_strategy_priority_active` 也是为不存在的"按 priority 选策略"功能
预先建的索引。一并移除以减少误导。
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id


class StrategyScope(str, enum.Enum):
    DEFAULT = "default"
    GENERAL = "general"


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    scope: Mapped[StrategyScope] = mapped_column(
        Enum(StrategyScope), default=StrategyScope.GENERAL, nullable=False, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(Text)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    effective_from: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    effective_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    definition: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    service_config: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)

    # Phase B: 审核规则集（rule_set）+ 处置规则（disposition_rule）。
    # PR B1 仅加列；NOT NULL 强约束到 PR B3 接管策略创建路径后置。
    rule_set_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rule_sets.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    disposition_rule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("disposition_rules.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    creator = relationship("User", foreign_keys=[created_by_id])
    rule_set = relationship("RuleSet", back_populates="strategies", foreign_keys=[rule_set_id])
    disposition_rule = relationship(
        "DispositionRule", back_populates="strategies", foreign_keys=[disposition_rule_id]
    )