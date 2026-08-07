"""make users.email nullable

email 和 username 至少填一个，DB 层不强制 email 非空（应用层校验）。
配合 20260807_users_username 迁移。

Revision ID: 20260807_users_email_nullable
Revises: 20260807_users_username
Create Date: 2026-08-07
"""
from __future__ import annotations

from alembic import op


revision: str = "20260807_users_email_nullable"
down_revision = "20260807_users_username"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "email", nullable=True)


def downgrade() -> None:
    op.alter_column("users", "email", nullable=False)
