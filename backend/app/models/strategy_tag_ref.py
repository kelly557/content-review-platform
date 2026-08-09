"""Strategy-Tag reference association — 策略与标签的引用关系.

记录「哪条策略引用了哪个标签」，供标签停用/删除前的引用检查（TagReferenceConfirmModal）
真实查询。此前为 mock 固定映射，本表落地后由策略保存/标签绑定流程写入。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class StrategyTagRef(Base):
    __tablename__ = "strategy_tag_refs"

    id: Mapped[int] = mapped_column(primary_key=True)
    strategy_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("strategies.id", ondelete="CASCADE"), index=True, nullable=False
    )
    tag_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tags.id", ondelete="CASCADE"), index=True, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
