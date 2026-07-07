"""StrategyItem: 策略启用项 (策略 ↔ 业务规则 item 的关联).

策略创建/编辑时，用户在 5 个 mediaType (image/text/audio/doc/video) 下的
item 列表中勾选要启用的业务规则（如「涉黄」「涉暴」）。该表持久化这种选择。
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


class StrategyItem(Base):
    __tablename__ = "strategy_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    strategy_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    media_type: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("audit_items.id", ondelete="CASCADE"), nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("strategy_id", "item_id", name="uq_strategy_item"),
        Index("ix_strategy_items_strategy", "strategy_id"),
    )