"""drop human_review_configs.notify_plan_id

Removed along with the "回调通知方案" feature on the 人机审核
configuration page. The column is not referenced anywhere else in
the codebase, so dropping it is safe.

Revision ID: drop_human_review_notify_plan
Revises: add_review_assignment_tags
Create Date: 2026-07-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "drop_human_review_notify_plan"
down_revision = "add_review_assignment_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("human_review_configs", "notify_plan_id")


def downgrade() -> None:
    op.add_column(
        "human_review_configs",
        sa.Column("notify_plan_id", sa.Integer(), nullable=True),
    )