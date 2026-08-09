"""add tag_id link columns to audit_items / audit_points

策略规则树（审核项/审核点/sub-审核点）一一映射三级标签体系：
  - audit_items.tag_id   → 一级标签
  - audit_points.tag_id  → 二级标签（顶级审核点）或三级标签（sub-审核点）

标签删除时 SET NULL（保留审核规则行，仅断开链接）。

Revision ID: 20260813_audit_rule_tag_links
Revises: 20260813_add_tag_modality
Create Date: 2026-08-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "20260813_audit_rule_tag_links"
down_revision = "20260813_add_tag_modality"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_items",
        sa.Column(
            "tag_id",
            sa.String(length=36),
            sa.ForeignKey("tags.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_audit_items_tag_id", "audit_items", ["tag_id"])
    op.add_column(
        "audit_points",
        sa.Column(
            "tag_id",
            sa.String(length=36),
            sa.ForeignKey("tags.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_audit_points_tag_id", "audit_points", ["tag_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_points_tag_id", table_name="audit_points")
    op.drop_column("audit_points", "tag_id")
    op.drop_index("ix_audit_items_tag_id", table_name="audit_items")
    op.drop_column("audit_items", "tag_id")
