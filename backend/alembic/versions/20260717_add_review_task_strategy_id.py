"""Add review_tasks.strategy_id FK

The /query page renders each task's "策略名称" from a JSONB snapshot at
``task.machine_result["strategy"]["name"]``. After v8 the production write
paths in ``app/tasks/machine_review.py`` and friends stopped populating
that sub-object, so the snapshot is always empty and ``_to_record``
falls back to ``task.stage_key`` — which on the ``hybrid`` template
renders as the literal string ``ai_scan`` (the first stage's key, not a
strategy name at all).

This migration adds a real FK column on ``review_tasks`` so the read
path can live-join the live ``strategies`` table for the canonical
strategy name. The column is nullable + ``ON DELETE SET NULL`` so
removing a strategy never cascades destructive deletes to historical
tasks; existing rows are left untouched (``strategy_id IS NULL`` for
every pre-migration task) and continue to render via the legacy
fallback chain. Backfill of historical rows is intentionally out of
scope (per product decision 2026-07-17).

Revision ID: 20260717_add_review_task_strategy_id
Revises: 20260716_review_detail_cleanup
Create Date: 2026-07-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260717_add_review_task_strategy_id"
down_revision = "20260716_review_detail_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_tasks",
        sa.Column("strategy_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_review_tasks_strategy_id",
        "review_tasks",
        "strategies",
        ["strategy_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_review_tasks_strategy_id",
        "review_tasks",
        ["strategy_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_review_tasks_strategy_id", table_name="review_tasks")
    op.drop_constraint(
        "fk_review_tasks_strategy_id", "review_tasks", type_="foreignkey"
    )
    op.drop_column("review_tasks", "strategy_id")
