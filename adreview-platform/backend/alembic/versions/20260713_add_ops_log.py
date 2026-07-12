"""add ops_log table for operator audit trail

Logs privileged/risky script invocations so we can answer
"who ran what when" after the fact (e.g., the 2026-07-12 16:30 seed.py
incident that silently overwrote manually-imported audit points).

Inserted from scripts via ``app.core.ops_log.record_op(...)``. No public
HTTP endpoint by design — the table is app-internal audit storage.

Revision ID: 20260713_add_ops_log
Revises: 20260713_trigger_override_human_review
Create Date: 2026-07-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260713_add_ops_log"
down_revision = "20260713_trigger_override_human_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ops_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("actor", sa.String(64), nullable=False, server_default="manual"),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("argv", sa.Text, nullable=True),
        sa.Column("cwd", sa.Text, nullable=True),
        sa.Column("detail", sa.JSON, nullable=True),
        sa.Column("message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_ops_log_action", "ops_log", ["action"])
    op.create_index("ix_ops_log_status", "ops_log", ["status"])
    op.create_index("ix_ops_log_created_at", "ops_log", ["created_at"])
    op.create_index(
        "ix_ops_log_action_created_at", "ops_log", ["action", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_ops_log_action_created_at", table_name="ops_log")
    op.drop_index("ix_ops_log_created_at", table_name="ops_log")
    op.drop_index("ix_ops_log_status", table_name="ops_log")
    op.drop_index("ix_ops_log_action", table_name="ops_log")
    op.drop_table("ops_log")
