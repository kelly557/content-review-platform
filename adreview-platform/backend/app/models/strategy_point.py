"""StrategyPoint: 策略启用审核点 (策略 ↔ 审核点的关联).

策略创建/编辑时，用户在某个 mediaType 下的 AuditItem 列表中勾选要启用的
业务规则（如「涉黄」「涉暴」）。StrategyItem 持久化这种 item 级别的选择。
本次新增：StrategyPoint 把 item 级别细化为 point 级别 —— 用户可以只勾
某条 item 下面的部分 point，其余 point 显式记为 is_enabled=false 而
保留行（决策：item 关 → point 自动关，但保留用户记忆；item 重开 → 恢复
之前显式记录的 point 状态）。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class StrategyPoint(Base):
    __tablename__ = "strategy_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    strategy_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    media_type: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("audit_items.id", ondelete="CASCADE"), nullable=False
    )
    point_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("audit_points.id", ondelete="CASCADE"), nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("strategy_id", "point_id", name="uq_strategy_point"),
        Index("ix_strategy_points_strategy", "strategy_id"),
    )
