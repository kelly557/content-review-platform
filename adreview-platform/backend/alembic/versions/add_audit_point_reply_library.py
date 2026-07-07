"""add audit_points.custom_reply_library_id

Lets a 审核点 (audit_point) reference a reply-type library (对话代答短语库)
so审核命中时返回代答话术。与现有 custom_library_id（词库/图库）并列，
互不影响。

Revision ID: add_audit_point_reply_library
Revises: 20260707_add_desensitization_recall
Create Date: 2026-07-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "add_audit_point_reply_library"
down_revision = "20260707_add_desensitization_recall"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_points",
        sa.Column("custom_reply_library_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_audit_points_custom_reply_library_id",
        "audit_points",
        ["custom_reply_library_id"],
    )
    op.create_foreign_key(
        "fk_audit_point_reply_library",
        "audit_points",
        "libraries",
        ["custom_reply_library_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_audit_point_reply_library", "audit_points", type_="foreignkey"
    )
    op.drop_index(
        "ix_audit_points_custom_reply_library_id", table_name="audit_points"
    )
    op.drop_column("audit_points", "custom_reply_library_id")