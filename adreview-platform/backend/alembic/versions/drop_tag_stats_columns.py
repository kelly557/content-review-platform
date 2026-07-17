"""drop tag stats / risk / action columns

Continue simplifying the Tag model: drop the L1-L4 risk ladder, the
action enum, and the hit/false-positive counters — these only made
sense with an execution engine that is intentionally not in P0 scope.

Revision ID: drop_tag_stats_columns
Revises: drop_tag_engine_tables
Create Date: 2026-07-06
"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "drop_tag_stats_columns"
down_revision = "drop_tag_engine_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS tags DROP COLUMN IF EXISTS false_positive_count")
    op.execute("ALTER TABLE IF EXISTS tags DROP COLUMN IF EXISTS hit_count_30d")
    op.execute("ALTER TABLE IF EXISTS tags DROP COLUMN IF EXISTS action")
    op.execute("ALTER TABLE IF EXISTS tags DROP COLUMN IF EXISTS risk_level")
    op.execute("DROP INDEX IF EXISTS ix_tag_status_risk")
    op.execute("DROP TYPE IF EXISTS tagrisklevel")
    op.execute("DROP TYPE IF EXISTS tagaction")


def downgrade() -> None:
    raise NotImplementedError("drop_tag_stats_columns has no downgrade path")
