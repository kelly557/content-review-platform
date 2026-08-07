"""add triggers + trigger_runs

Triggers define *when* and *what strategy* to apply for review tasks.
A trigger can be time-driven (cron) or external-callback driven. Each
trigger embeds an optional routing strategy (Strategy FK) plus a
``match_conditions`` JSONB blob that filters materials by 5 standard
keys (material_type / business_line / country / channel / content_category).

Trigger runs record execution history with counts and status. They
cascade-delete with their parent trigger.

Revision ID: 20260710_add_triggers
Revises: 20260709_add_task_cancellation
Create Date: 2026-07-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "20260710_add_triggers"
down_revision = "20260709_add_task_cancellation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── triggers ─────────────────────────────────────────────────
    op.create_table(
        "triggers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(64), unique=True, nullable=False, index=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column(
            "trigger_type",
            sa.String(32),
            nullable=False,
        ),
        sa.Column("is_enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("spec", JSONB, nullable=False),
        sa.Column("workflow_template_code", sa.String(64), nullable=True),
        sa.Column(
            "strategy_id",
            sa.Integer,
            sa.ForeignKey("strategies.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("match_conditions", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("scan_interval_sec", sa.Integer, nullable=False, server_default="60"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("run_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column(
            "created_by",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_triggers_enabled_type", "triggers", ["is_enabled", "trigger_type"])
    op.create_index(
        "ix_triggers_next_run",
        "triggers",
        ["next_run_at"],
        postgresql_where=sa.text("is_enabled = TRUE AND trigger_type = 'cron'"),
    )

    # ── trigger_runs ────────────────────────────────────────────
    op.create_table(
        "trigger_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "trigger_id",
            sa.Integer,
            sa.ForeignKey("triggers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=True),
        sa.Column("scanned_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("details", JSONB, nullable=True),
    )
    op.create_index("ix_trigger_runs_trigger", "trigger_runs", ["trigger_id", "started_at"])
    op.create_index("ix_trigger_runs_started", "trigger_runs", ["started_at"])


def downgrade() -> None:
    op.drop_index("ix_trigger_runs_started", table_name="trigger_runs")
    op.drop_index("ix_trigger_runs_trigger", table_name="trigger_runs")
    op.drop_table("trigger_runs")
    op.drop_index("ix_triggers_next_run", table_name="triggers")
    op.drop_index("ix_triggers_enabled_type", table_name="triggers")
    op.drop_table("triggers")