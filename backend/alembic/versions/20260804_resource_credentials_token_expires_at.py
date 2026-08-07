"""add resource_credentials.token_expires_at

记录 API Key 的过期时间 (可选)。前端模型列表「Token 有效时间」列展示用。

业务约束:
  - 凭证级 (resource_credentials) 而非模型级；同一 Provider 下多个模型共享此字段。
  - NULL = 用户未配置或不想提醒。
  - 过期：仅展示，不在后端做任何自动动作（不阻塞调用）。

Revision ID: 20260804_resource_credentials_token_expires_at
Revises: 20260803_library_tag_binding
Create Date: 2026-08-04
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "20260804_resource_credentials_token_expires_at"
down_revision = "20260803_library_tag_binding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resource_credentials",
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("resource_credentials", "token_expires_at")
