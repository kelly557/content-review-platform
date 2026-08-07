"""add users.username

新增 username 字段（用户名登录标识）。

业务约束:
  - nullable=True：老用户无 username，只能用 email 登录。
  - 新用户创建时 username 全局唯一（应用层校验 + DB 唯一索引）。
  - 登录时后端按输入是否含 @ 区分走 email 还是 username 查询。
  - email 列保持不变（通知/找回密码仍用）。

Revision ID: 20260807_users_username
Revises: 20260804_resource_credentials_token_expires_at
Create Date: 2026-08-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "20260807_users_username"
down_revision = "20260804_resource_credentials_token_expires_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("username", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_users_username",
        "users",
        ["username"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
