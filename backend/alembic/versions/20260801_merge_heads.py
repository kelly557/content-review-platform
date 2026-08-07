"""merge heads: 20260723_add_page_guide + 20260801_add_roles_table

Revision ID: 20260801_merge_heads
Revises: 20260723_add_page_guide, 20260801_add_roles_table
Create Date: 2026-08-01

No-op merge revision. The dev DB has the 20260723 branch fully applied
(stamped), so this migration only needs to be stamped forward — not run.
For new dev DBs starting from scratch, alembic upgrade head will run
both branches in some order (the order isn't deterministic but both
branches touch disjoint tables, so it's safe).
"""
from __future__ import annotations


# revision identifiers, used by Alembic.
revision = "20260801_merge_heads"
down_revision = ("20260723_add_page_guide", "20260801_add_roles_table")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
