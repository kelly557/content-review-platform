"""MachineReviewFeedback — reviewer/admin marking on machine review quality.

Captures two distinct signals of disagreement between the human reviewer and the
machine review verdict on a given ``ReviewTask``:

- ``false_positive`` (未违规误报): the machine flagged content the reviewer
  thinks was actually compliant.
- ``false_negative`` (违规漏过): the machine passed content the reviewer
  believes should have been flagged.

One ``ReviewTask`` can accumulate multiple feedback rows over time. The UI surfaces
the most recent one via ``ReviewTask.last_feedback``. The full history is
persisted for future accuracy / drift dashboards.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.id_generator import new_public_id
from app.db.session import Base


class FeedbackKind(str, Enum):
    FALSE_POSITIVE = "false_positive"  # 未违规误报
    FALSE_NEGATIVE = "false_negative"  # 违规漏过


class MachineReviewFeedback(Base):
    __tablename__ = "machine_review_feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    task_id: Mapped[int] = mapped_column(
        ForeignKey("review_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    __table_args__ = (
        Index("ix_machine_review_feedback_task_created", "task_id", "created_at"),
    )