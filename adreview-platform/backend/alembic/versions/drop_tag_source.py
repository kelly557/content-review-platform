"""drop tag source column

Remove the now-unused source enum / column from the tags table. Source
information has been retired from the P0 surface; the platform-built-in
distinction is preserved only in the seed script's known codes.

Revision ID: drop_tag_source
Revises: drop_tag_stats_columns
Create Date: 2026-07-07
"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "drop_tag_source"
down_revision = "drop_tag_stats_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tags_source")
    op.execute("ALTER TABLE IF EXISTS tags DROP COLUMN IF EXISTS source")
    op.execute("DROP TYPE IF EXISTS tagsource")


def downgrade() -> None:
    raise NotImplementedError("drop_tag_source has no downgrade path")
