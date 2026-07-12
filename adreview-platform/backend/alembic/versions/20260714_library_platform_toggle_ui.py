"""library is_platform toggle through API/UI (no schema change)

Marks the milestone where the existing ``libraries.is_platform`` column
(added in 20260712_add_superadmin_and_library_platform) becomes configurable
through the API/UI for superadmins only.

Non-superadmin clients get HTTP 422 if they try to set is_platform=true;
superadmins can flip the flag on any library at any time.

No DDL is executed — column already exists with server_default=false.

Revision ID: 20260714_library_platform_toggle_ui
Revises: 20260713_add_ops_log
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op


revision = "20260714_library_platform_toggle_ui"
down_revision = "20260713_add_ops_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # libraries.is_platform 已在 20260712_add_superadmin_and_library_platform 中加好,
    # 这里仅作为「服务端 / 前端暴露给超级管理员的里程碑」锚点,不做 DDL。
    pass


def downgrade() -> None:
    pass