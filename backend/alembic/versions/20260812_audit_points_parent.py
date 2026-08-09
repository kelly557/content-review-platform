"""add audit_points.parent_point_id

三级审核点（sub audit point）自引用，支撑 RulesTreeView 三级 sub 列表
从后端拉取（替代前端 getMockSubAuditPoints）。

Revision ID: 20260812_audit_points_parent
Revises: 20260812_add_strategy_tag_refs
Create Date: 2026-08-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "20260812_audit_points_parent"
down_revision = "20260812_add_strategy_tag_refs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_points",
        sa.Column(
            "parent_point_id",
            sa.Integer(),
            sa.ForeignKey("audit_points.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_audit_points_parent_point_id", "audit_points", ["parent_point_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_audit_points_parent_point_id", table_name="audit_points")
    op.drop_column("audit_points", "parent_point_id")
