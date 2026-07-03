"""Review task + assignment models."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ReviewDecision(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    RETURNED = "returned"  # sent back to submitter for revision


class ReviewType(str, enum.Enum):
    MACHINE = "machine"
    HUMAN = "human"


class MachineStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ReviewTask(Base):
    """A review cycle tied to a (material, version, workflow instance)."""

    __tablename__ = "review_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_version_id: Mapped[int] = mapped_column(
        ForeignKey("material_versions.id", ondelete="CASCADE"), nullable=False
    )
    workflow_instance_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stage_key: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    review_type: Mapped[ReviewType] = mapped_column(
        Enum(ReviewType), default=ReviewType.HUMAN, nullable=False, index=True
    )

    final_decision: Mapped[ReviewDecision] = mapped_column(
        Enum(ReviewDecision), default=ReviewDecision.PENDING, nullable=False, index=True
    )

    machine_status: Mapped[Optional[MachineStatus]] = mapped_column(
        Enum(MachineStatus), nullable=True, index=True
    )
    machine_result: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    machine_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    machine_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    assignments: Mapped[List["ReviewAssignment"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )
    comments: Mapped[List["ReviewComment"]] = relationship(  # type: ignore[name-defined]
        back_populates="task", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_review_task_stage", "workflow_instance_id", "stage_key"),)


class ReviewAssignment(Base):
    """Per-reviewer allocation: who must act on this task."""

    __tablename__ = "review_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("review_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assignee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    decision: Mapped[ReviewDecision] = mapped_column(
        Enum(ReviewDecision), default=ReviewDecision.PENDING, nullable=False
    )
    note: Mapped[Optional[str]] = mapped_column(Text)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    task = relationship("ReviewTask", back_populates="assignments")
    assignee = relationship("User", back_populates="review_assignments", foreign_keys=[assignee_id])
