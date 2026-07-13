"""Review task + assignment models."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

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


class ReviewDecision(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    RETURNED = "returned"  # sent back to submitter for revision
    CANCELED = "canceled"  # operator-initiated cancellation (v10)


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
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
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
    strategy_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    machine_result: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    machine_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    machine_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # v10: cancellation fields (operator-initiated cancel from UI / API).
    canceled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    canceled_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancel_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    assignments: Mapped[List["ReviewAssignment"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_review_task_stage", "workflow_instance_id", "stage_key"),)


class ReviewAssignment(Base):
    """Per-reviewer allocation: who must act on this task."""

    __tablename__ = "review_assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
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
    tag_links: Mapped[List["ReviewAssignmentTag"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )
    audit_item_links: Mapped[List["ReviewAssignmentAuditItem"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )

    @property
    def tags(self) -> List["ReviewAssignmentTag"]:
        return list(self.tag_links or [])

    @property
    def audit_items(self) -> List["ReviewAssignmentAuditItem"]:
        return list(self.audit_item_links or [])


class ReviewAssignmentTag(Base):
    """Tag label annotated by a reviewer on their assignment decision.

    ``tag_snapshot`` is a JSONB copy of the Tag at decision time
    (``{id, code, name, domain, category, status}``) so historical
    annotations remain readable even if the source Tag is later
    deprecated or soft-deleted.
    """

    __tablename__ = "review_assignment_tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("review_assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tag_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    tag_snapshot: Mapped[dict] = mapped_column(_JSONType, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    assignment = relationship("ReviewAssignment", back_populates="tag_links")

    __table_args__ = (
        Index("ix_rat_assignment_tag", "assignment_id", "tag_id", unique=True),
    )


class ReviewAssignmentAuditItem(Base):
    """审核项勾选：reviewer 在 decide 时勾选了哪些 AuditItem。

    ``item_snapshot`` 是 AuditItem 在决策时刻的快照
    （``{id, package_code, code, name_cn, aliases, is_enabled}``），
    这样即使 AuditItem 后来被禁用 / 软删，历史勾选仍然可读。
    """

    __tablename__ = "review_assignment_audit_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("review_assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    audit_item_id: Mapped[int] = mapped_column(
        ForeignKey("audit_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    item_snapshot: Mapped[dict] = mapped_column(_JSONType, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    assignment = relationship("ReviewAssignment", back_populates="audit_item_links")

    __table_args__ = (
        Index(
            "ix_raai_assignment_item",
            "assignment_id",
            "audit_item_id",
            unique=True,
        ),
    )
