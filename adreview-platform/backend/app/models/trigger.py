"""Trigger and TriggerRun models.

A trigger is a scheduling rule: *when* (cron or external callback) and
*what strategy* to apply (Strategy FK + match_conditions JSONB).

Trigger runs record execution history. They cascade-delete with their
parent trigger.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class TriggerType(str, enum.Enum):
    CRON = "cron"
    EXTERNAL_CALLBACK = "external_callback"


class TriggerRunSource(str, enum.Enum):
    CRON = "cron"
    MANUAL = "manual"
    CALLBACK = "callback"


class TriggerRunStatus(str, enum.Enum):
    RUNNING = "running"
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class Trigger(Base):
    __tablename__ = "triggers"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(32), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    spec: Mapped[dict] = mapped_column(JSONB, nullable=False)
    workflow_template_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    strategy_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL"), nullable=True
    )
    match_conditions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    scan_interval_sec: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
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

    strategy = relationship("Strategy", foreign_keys=[strategy_id])
    runs: Mapped[list["TriggerRun"]] = relationship(
        back_populates="trigger",
        cascade="all, delete-orphan",
        order_by="TriggerRun.started_at.desc()",
    )

    __table_args__ = (Index("ix_triggers_enabled_type", "is_enabled", "trigger_type"),)


class TriggerRun(Base):
    __tablename__ = "trigger_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    trigger_id: Mapped[int] = mapped_column(
        ForeignKey("triggers.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    scanned_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    details: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    trigger = relationship("Trigger", back_populates="runs")

    __table_args__ = (
        Index("ix_trigger_runs_trigger", "trigger_id", "started_at"),
        Index("ix_trigger_runs_started", "started_at"),
    )


class WebhookIpAllowlist(Base):
    __tablename__ = "webhook_ip_allowlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    cidr: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_webhook_allowlist_enabled", "is_enabled"),)