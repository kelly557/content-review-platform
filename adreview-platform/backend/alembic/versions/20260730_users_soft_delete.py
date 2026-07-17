"""users: soft-delete columns (is_deleted + deleted_at)

Revision ID: 20260730_users_soft_delete
Revises: 20260729_audit_item_agent_thresholds
Create Date: 2026-07-30

- 加 ``is_deleted``（Boolean, NOT NULL, default false, indexed） 与
  ``deleted_at``（TIMESTAMP NULL）两列。
- 现有行默认 false/NULL —— 历史用户不受影响。
- list/update/delete 端点后续会在 WHERE 子句里过滤 ``is_deleted = false``，
  以实现「软删除」语义。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260730_users_soft_delete"
down_revision = "20260729_audit_item_agent_thresholds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    is_deleted_col = sa.Column(
        "is_deleted",
        sa.Boolean(),
        nullable=False,
        server_default=sa.text("false"),
    )
    is_deleted_idx = sa.Index("ix_users_is_deleted", "is_deleted")
    op.add_column("users", is_deleted_col)
    if is_pg:
        op.create_index("ix_users_is_deleted", "users", ["is_deleted"])

    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.drop_index("ix_users_is_deleted", table_name="users")
    op.drop_column("users", "deleted_at")
    op.drop_column("users", "is_deleted")
