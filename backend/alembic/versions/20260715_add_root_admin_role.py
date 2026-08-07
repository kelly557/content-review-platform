"""add ROOT_ADMIN role to userrole enum

Adds the ``ROOT_ADMIN`` value to the ``userrole`` PostgreSQL enum.
root_admin inherits all superadmin privileges and is the only role
that can see 工作区, 策略中心/人工审核策略, and 系统管理 navigation sections.

Revision ID: 20260715_add_root_admin_role
Revises: 20260726_audit_item_large_model_version
Create Date: 2026-07-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260715_add_root_admin_role"
down_revision = "20260726_audit_item_large_model_version"
branch_labels = None
depends_on = None


def _enum_values(bind, type_name: str) -> list[str]:
    """Return the current values of a PG enum, or [] on other dialects."""
    if bind.dialect.name != "postgresql":
        return []
    rows = bind.execute(
        sa.text(
            "SELECT enumlabel FROM pg_enum "
            "WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = :name LIMIT 1) "
            "ORDER BY enumsortorder"
        ),
        {"name": type_name},
    ).fetchall()
    return [r[0] for r in rows]


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg and "ROOT_ADMIN" not in _enum_values(bind, "userrole"):
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'ROOT_ADMIN'")


def downgrade() -> None:
    pass
