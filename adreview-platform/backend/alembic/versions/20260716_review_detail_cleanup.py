"""Review task detail cleanup: review_comments gone, llm_calls + audit_items in.

Includes:
- DROP TABLE review_comments (write-only API surface, no UI reader)
- CREATE TABLE llm_calls (telemetry for MaaS moderation calls)
- CREATE TABLE review_assignment_audit_items (checklist answer per decide)

Revision ID: 20260716_review_detail_cleanup
Revises: 20260715_phase_b_split_strategy
Create Date: 2026-07-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260716_review_detail_cleanup"
down_revision = "20260715_phase_b_split_strategy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Drop the read-only-but-write surface; nothing references the rows
    #    downstream. CASCADE drops FK constraints referencing it.
    op.execute("DROP TABLE IF EXISTS review_comments CASCADE")

    # 2. llm_calls telemetry
    jsonb = (
        postgresql.JSONB(astext_type=sa.Text())
        if bind.dialect.name == "postgresql"
        else sa.JSON()
    )
    op.create_table(
        "llm_calls",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("version_id", sa.Integer(), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("schema_valid", sa.Boolean(), nullable=False),
        sa.Column("truncated", sa.Boolean(), nullable=False),
        sa.Column("input_chars", sa.Integer(), nullable=True),
        sa.Column("token_in", sa.Integer(), nullable=True),
        sa.Column("token_out", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["review_tasks.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["version_id"], ["material_versions.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint("public_id", name="uq_llm_calls_public_id"),
    )
    op.create_index("ix_llm_calls_public_id", "llm_calls", ["public_id"])
    op.create_index("ix_llm_calls_task_id", "llm_calls", ["task_id"])
    op.create_index(
        "ix_llm_calls_correlation_id", "llm_calls", ["correlation_id"]
    )
    op.create_index("ix_llm_calls_ok", "llm_calls", ["ok"])
    op.create_index("ix_llm_calls_created_at", "llm_calls", ["created_at"])

    # 3. review_assignment_audit_items (the new checklist answer)
    op.create_table(
        "review_assignment_audit_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("audit_item_id", sa.Integer(), nullable=False),
        sa.Column(
            "item_snapshot", jsonb, nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["review_assignments.id"],
            ondelete="CASCADE",
            name="fk_raai_assignment",
        ),
        sa.ForeignKeyConstraint(
            ["audit_item_id"],
            ["audit_items.id"],
            ondelete="RESTRICT",
            name="fk_raai_audit_item",
        ),
        sa.UniqueConstraint(
            "public_id", name="uq_raai_public_id"
        ),
    )
    op.create_index(
        "ix_raai_public_id", "review_assignment_audit_items", ["public_id"]
    )
    op.create_index(
        "ix_raai_assignment_id",
        "review_assignment_audit_items",
        ["assignment_id"],
    )
    op.create_index(
        "ix_raai_audit_item_id",
        "review_assignment_audit_items",
        ["audit_item_id"],
    )
    op.create_index(
        "ix_raai_assignment_item",
        "review_assignment_audit_items",
        ["assignment_id", "audit_item_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_raai_assignment_item", table_name="review_assignment_audit_items"
    )
    op.drop_index(
        "ix_raai_audit_item_id", table_name="review_assignment_audit_items"
    )
    op.drop_index(
        "ix_raai_assignment_id", table_name="review_assignment_audit_items"
    )
    op.drop_index("ix_raai_public_id", table_name="review_assignment_audit_items")
    op.drop_table("review_assignment_audit_items")

    op.drop_index("ix_llm_calls_created_at", table_name="llm_calls")
    op.drop_index("ix_llm_calls_ok", table_name="llm_calls")
    op.drop_index("ix_llm_calls_correlation_id", table_name="llm_calls")
    op.drop_index("ix_llm_calls_task_id", table_name="llm_calls")
    op.drop_index("ix_llm_calls_public_id", table_name="llm_calls")
    op.drop_table("llm_calls")

    # Recreate review_comments (downgrade not exercised in prod; just the shape)
    op.create_table(
        "review_comments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["review_tasks.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
    )
