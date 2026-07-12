"""Workflow definition: reusable approval flow templates and per-material instances."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id


class WorkflowTemplate(Base):
    """Reusable multi-stage approval flow definition (e.g. 2-step, 3-step, MLR)."""

    __tablename__ = "workflow_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    definition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # definition shape (suggested):
    # {"stages": [
    #     {"key": "initial", "name": "初审", "role": "reviewer", "mode": "single"},
    #     {"key": "final",   "name": "终审", "role": "reviewer", "mode": "single"},
    #     {"key": "mlr",     "name": "MLR 复核", "role": "mlr", "mode": "joint"}
    # ]}
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkflowInstance(Base):
    """A live run of a template, bound to one material version."""

    __tablename__ = "workflow_instances"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_version_id: Mapped[int] = mapped_column(
        ForeignKey("material_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    template_id: Mapped[int] = mapped_column(ForeignKey("workflow_templates.id"), nullable=False)

    state: Mapped[str] = mapped_column(String(32), default="running", nullable=False, index=True)
    # state ∈ {running, approved, rejected, withdrawn, cancelled}
    current_stage_key: Mapped[Optional[str]] = mapped_column(String(64))

    # Snapshot of strategy.definition.human_review at instance start time.
    # Read by should_escalate_to_human to decide machine → human escalation.
    # Shape: {"is_enabled": bool, "risk_levels": [str], "review_rule_id": int | null}
    strategy_human_review: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    template = relationship("WorkflowTemplate")
    nodes: Mapped[List["WorkflowNode"]] = relationship(
        back_populates="instance", order_by="WorkflowNode.position"
    )


class WorkflowNode(Base):
    """Stage instance - one row per stage per workflow run."""

    __tablename__ = "workflow_nodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    instance_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_key: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    required_role: Mapped[str] = mapped_column(String(32), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), default="single", nullable=False)
    # mode ∈ {single, joint, all}  - joint = all must approve, all = at least one

    node_type: Mapped[str] = mapped_column(String(16), default="human", nullable=False)
    # node_type ∈ {machine, human}

    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False, index=True)
    # status ∈ {pending, active, approved, rejected, skipped}

    instance = relationship("WorkflowInstance", back_populates="nodes")
