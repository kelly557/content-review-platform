"""roles: drop sort_order column (不再使用)

Revision ID: 20260801_drop_roles_sort_order
Revises: 20260801_userrole_add_staff
Create Date: 2026-08-01

- 删除 ``roles.sort_order`` 列 + ``ix_roles_sort_order`` 索引。
- 列表排序改回 id asc。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260801_drop_roles_sort_order"
down_revision = "20260801_userrole_add_staff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.drop_index("ix_roles_sort_order", table_name="roles")
    op.drop_column("roles", "sort_order")


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.add_column(
        "roles",
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    if is_pg:
        op.create_index("ix_roles_sort_order", "roles", ["sort_order", "id"])
