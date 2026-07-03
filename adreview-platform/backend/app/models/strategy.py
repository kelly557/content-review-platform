"""Strategy configuration model.

Represents a review/risk strategy that can be activated based on time window,
priority, and toggle state. The "default" strategy is a singleton that takes
effect when no other strategy is active.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class StrategyScope(str, enum.Enum):
    DEFAULT = "default"
    GENERAL = "general"


class Strategy(Base):
    __tablename__ = "strategies"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    scope: Mapped[StrategyScope] = mapped_column(
        Enum(StrategyScope), default=StrategyScope.GENERAL, nullable=False, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(Text)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    effective_from: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    effective_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    definition: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    service_config: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    creator = relationship("User", foreign_keys=[created_by_id])

    __table_args__ = (
        Index("ix_strategy_priority_active", "priority", "is_active"),
    )