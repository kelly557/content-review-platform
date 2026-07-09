"""add task cancellation fields + canceled decision value

Adds three nullable columns on ``review_tasks``:

- ``canceled_at``    — timestamp of cancellation
- ``canceled_by``    — FK to users.id (the operator who cancelled)
- ``cancel_reason``  — free-text reason

Also extends the ``ReviewDecision`` enum with the new ``CANCELED`` value
(matching the existing UPPER-CASE convention used by PENDING / APPROVED
/ REJECTED / RETURNED — SQLAlchemy writes enum member names by default).

v10 改造：支持任务级取消（机审中/排队中/等待人审均可触发）。
机审 worker 写到结果后会因 ``final_decision='CANCELED'`` 被丢弃，
不影响后续审计与统计查询。

Revision ID: 20260709_add_task_cancellation
Revises: 20260708_drop_strategy_priority
Create Date: 2026-07-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260709_add_task_cancellation"
down_revision = "20260708_drop_strategy_priority"
branch_labels = None
depends_on = None


def _enum_values(bind, type_name: str) -> list[str]:
    """Return the current values of a PG enum, or [] on other dialects."""
    if bind.dialect.name != "postgresql":
        return []
    rows = bind.execute(
        sa.text(
            "SELECT enumlabel FROM pg_enum "
            "WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = :name) "
            "ORDER BY enumsortorder"
        ),
        {"name": type_name},
    ).fetchall()
    return [r[0] for r in rows]


def _pg_add_value(bind, type_name: str, value: str) -> None:
    if bind.dialect.name != "postgresql":
        return
    if value in _enum_values(bind, type_name):
        return
    op.execute(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{value}'")


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Extend ReviewDecision enum with 'CANCELED' (upper-case to match
    #    existing PENDING / APPROVED / REJECTED / RETURNED; SQLAlchemy
    #    writes enum member NAMES by default on PG).
    _pg_add_value(bind, "reviewdecision", "CANCELED")

    # 2. Add nullable cancellation columns on review_tasks
    op.add_column(
        "review_tasks",
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "review_tasks",
        sa.Column(
            "canceled_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "review_tasks",
        sa.Column("cancel_reason", sa.String(500), nullable=True),
    )

    # 3. Index for quick lookups of cancelled tasks in reports
    op.create_index(
        "ix_review_tasks_canceled_at",
        "review_tasks",
        ["canceled_at"],
    )


def downgrade() -> None:
    # PG cannot DROP an enum VALUE; safe rollback is "leave it in place"
    # and drop the columns / index only.
    op.drop_index("ix_review_tasks_canceled_at", table_name="review_tasks")
    op.drop_column("review_tasks", "cancel_reason")
    op.drop_column("review_tasks", "canceled_by")
    op.drop_column("review_tasks", "canceled_at")