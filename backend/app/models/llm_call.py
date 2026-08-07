"""LlmCall model: append-only telemetry for MaaS moderation calls.

Distinct from ``audit_events`` (governance) — LlmCall tracks runtime health
(latency, retries, schema validity, token usage, error messages) so we can
alert on degradation without polluting the audit trail.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.core.id_generator import new_public_id


class LlmCall(Base):
    __tablename__ = "llm_calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )

    task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("review_tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    version_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("material_versions.id", ondelete="SET NULL"), nullable=True
    )
    correlation_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )

    model: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)
    schema_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    input_chars: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_in: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_out: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
