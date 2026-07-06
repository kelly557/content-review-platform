"""add review assignment tags + tag soft delete

Connects human review tags to ``tags`` table (one-to-many via
``ReviewAssignmentTag``) and adds ``deleted_at`` on Tag so historical
annotations survive deletion (snapshot is captured at decide time).

Revision ID: add_review_assignment_tags
Revises: drop_tag_stats_columns
Create Date: 2026-07-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "add_review_assignment_tags"
down_revision = "drop_tag_stats_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tag soft-delete
    op.add_column(
        "tags",
        sa.Column("deleted_at", sa.DateTime(timezone=False), nullable=True),
    )
    op.create_index("ix_tags_deleted_at", "tags", ["deleted_at"], unique=False)

    # ReviewAssignmentTag link
    op.create_table(
        "review_assignment_tags",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.String(length=36), nullable=False),
        sa.Column(
            "tag_snapshot",
            postgresql.JSONB(astext_type=sa.Text())
            if op.get_bind().dialect.name == "postgresql"
            else sa.JSON(),
            nullable=False,
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
            name="fk_rat_assignment",
        ),
    )
    op.create_index(
        "ix_review_assignment_tags_assignment_id",
        "review_assignment_tags",
        ["assignment_id"],
        unique=False,
    )
    op.create_index(
        "ix_review_assignment_tags_tag_id",
        "review_assignment_tags",
        ["tag_id"],
        unique=False,
    )
    op.create_index(
        "ix_rat_assignment_tag",
        "review_assignment_tags",
        ["assignment_id", "tag_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_rat_assignment_tag", table_name="review_assignment_tags")
    op.drop_index("ix_review_assignment_tags_tag_id", table_name="review_assignment_tags")
    op.drop_index("ix_review_assignment_tags_assignment_id", table_name="review_assignment_tags")
    op.drop_table("review_assignment_tags")
    op.drop_index("ix_tags_deleted_at", table_name="tags")
    op.drop_column("tags", "deleted_at")