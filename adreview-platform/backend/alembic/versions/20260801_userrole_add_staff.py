"""users: UserRole enum 加 'staff' 值 (业务员)

Revision ID: 20260801_userrole_add_staff
Revises: 20260801_merge_heads
Create Date: 2026-08-01

- PostgreSQL: ALTER TYPE userrole ADD VALUE 'staff';
- SQLite (test): 无操作 (SQLite enum 是 String, 不需要迁移)。
"""
from __future__ import annotations

from alembic import op


revision = "20260801_userrole_add_staff"
down_revision = "20260801_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Postgres 允许在事务内 ALTER TYPE ADD VALUE
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'staff'")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # PG enum value 一旦加上不能直接 DROP, 需要重建 enum
        # 此处保守处理: 仅留 noop, 若需回滚需手写 PG enum 重建脚本
        pass
