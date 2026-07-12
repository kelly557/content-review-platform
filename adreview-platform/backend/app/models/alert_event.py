"""AlertEvent — analytics anomaly detection record.

Persisted when the background scanner (``app.services.anomaly_scanner``)
detects a metric crossing a configured threshold. UI surfaces the open set
on the 异常分析 tab; the notification channel is fire-and-forget.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, TypeDecorator, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.core.id_generator import new_public_id


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        from sqlalchemy.dialects.postgresql import JSONB

        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class AlertEvent(Base):
    __tablename__ = "alert_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    rule_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="warn")
    metric: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    observed_value: Mapped[float] = mapped_column(Float, nullable=False)
    threshold: Mapped[float] = mapped_column(Float, nullable=False)

    dimension: Mapped[dict] = mapped_column(_JSONType, default=dict)
    detail: Mapped[dict] = mapped_column(_JSONType, default=dict)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    ack_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    ack_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ack_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    notified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    __table_args__ = (
        Index("ix_alert_status_created", "status", "created_at"),
        Index("ix_alert_rule_window", "rule_code", "window_start", "window_end"),
    )
