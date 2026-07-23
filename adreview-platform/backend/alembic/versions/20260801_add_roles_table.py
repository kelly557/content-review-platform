"""roles: metadata table for Role CRUD (Phase 4)

Revision ID: 20260801_add_roles_table
Revises: 20260731_library_risk_point
Create Date: 2026-08-01

- 新建 ``roles`` 表：id, key(unique), display_name, description,
  is_active, is_builtin, sort_order, created_at, updated_at。
- ``key`` 镜像 ``UserRole`` enum 值（短期双轨：users.role 仍为 enum，
  本表只存角色元数据，不上 FK）。
- seed 阶段会把 6 个 enum 值（submitter / reviewer / mlr / admin /
  superadmin / root_admin）upsert 进 roles 表，is_builtin=True。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260801_add_roles_table"
down_revision = "20260731_library_risk_point"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=32), nullable=False, unique=True),
        sa.Column("display_name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    if is_pg:
        op.create_index("ix_roles_key", "roles", ["key"])
        op.create_index("ix_roles_sort_order", "roles", ["sort_order", "id"])


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.drop_index("ix_roles_sort_order", table_name="roles")
        op.drop_index("ix_roles_key", table_name="roles")
    op.drop_table("roles")
