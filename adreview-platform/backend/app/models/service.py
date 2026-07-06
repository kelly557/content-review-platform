"""Service model: catalog of text-audit services selectable per strategy.

A Service is a unit of detection (e.g. "chat_detection_pro" = 私聊互动内容检测_专业版).
Strategies reference selected services by code via strategy.definition.services[].
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ServiceScope(str, enum.Enum):
    BUSINESS = "业务场景"
    SPECIAL = "特殊场景"
    AIGC = "AIGC场景"
    BAILIAN = "百炼场景"
    GENERAL = "通用场景"


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    scope: Mapped[ServiceScope] = mapped_column(
        Enum(ServiceScope), default=ServiceScope.BUSINESS, nullable=False, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_rule_package: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    category_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("service_categories.id"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (Index("ix_service_scope_active", "scope", "is_active"),)