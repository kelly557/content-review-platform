"""Risk category — 可由超管运营维护的小模型风险类型字典。

历史上由后端 enum (`SmallModelCategory`) 锁死 9 项；本期开始改为数据库字典，
新建可由 superadmin / root_admin 在前端触发。audit_items 侧仍按 enum 字符串
(`code`) 引用，因此 9 行 seed 必须与原 enum 的 `value` 完全一致。
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class RiskCategory(Base):
    """风险类型字典。

    - ``code`` 唯一，是 wire-level 标识（沿用历史 enum 值兼容老数据）。
    - ``is_builtin=True`` 由 seed 写入，前端不允许删除 / 改 code。
    - ``sort_order`` 用于色板轮询分配 / 列表排序。
    """

    __tablename__ = "risk_categories"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[str] = mapped_column(String(32), nullable=False, default="default")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
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

    __table_args__ = (
        Index("ix_risk_categories_sort_order", "sort_order"),
    )
