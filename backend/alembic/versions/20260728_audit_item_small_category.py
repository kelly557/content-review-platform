"""audit_items: add small_category column

Revision ID: 20260728_audit_item_small_category
Revises: 20260727_rename_lmv
Create Date: 2026-07-28

- 加 small_category 列（String 32, nullable, indexed）
- seed 负责回填
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260728_audit_item_small_category"
down_revision = "20260727_rename_lmv"
branch_labels = None
depends_on = None

TABLE = "audit_items"
COL = "small_category"


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns(TABLE)}
    if COL not in cols:
        op.add_column(TABLE, sa.Column(COL, sa.String(length=32), nullable=True))
        op.create_index(
            f"ix_{TABLE}_{COL}",
            TABLE,
            [COL],
        )


def downgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns(TABLE)}
    if COL in cols:
        op.drop_index(f"ix_{TABLE}_{COL}", table_name=TABLE)
        op.drop_column(TABLE, COL)