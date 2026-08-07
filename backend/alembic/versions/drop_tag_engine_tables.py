"""drop tag engine tables

Strip the L0/L1 hit engine infrastructure that was added in
``e6107dd`` and is being removed in the simplified P0 CRUD-only tag
implementation:

* ``tag_hit_rules`` — hit-rule payloads (keyword/regex/semantic/agent)
* ``tag_hits`` — reverse index of resolved hits (bidirectional)
* ``tag_negative_samples`` — false-positive/false-negative feedback

The ``tags`` table itself is preserved.

Revision ID: drop_tag_engine_tables
Revises:
Create Date: 2026-07-06
"""
from __future__ import annotations

from alembic import op


# revision identifiers, used by Alembic.
revision = "drop_tag_engine_tables"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tag_hits")
    op.execute("DROP TABLE IF EXISTS tag_negative_samples")
    op.execute("DROP TABLE IF EXISTS tag_hit_rules")


def downgrade() -> None:
    # Downgrade is intentionally a no-op: re-creating the dropped tables
    # would require the original column shapes. Operationally the user should
    # restore from backup if rollback is needed.
    raise NotImplementedError("drop_tag_engine_tables has no downgrade path")
