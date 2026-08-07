"""libraries: risk_point_id (二级风险标签 → 代答库使用位置定位)

Revision ID: 20260731_library_risk_point
Revises: 20260730_users_soft_delete
Create Date: 2026-07-31

- 给 libraries 加 ``risk_point_id`` (Integer, FK -> audit_points.id ON DELETE SET NULL, indexed)。
- 历史存量行保持 NULL（兼容：reply 库允许在编辑时再补齐）。
- 仅 reply 库在 API 层强制「新增/编辑」必传（见 backend/app/schemas/library.py）。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260731_library_risk_point"
down_revision = "20260730_users_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.add_column(
        "libraries",
        sa.Column("risk_point_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_libraries_risk_point",
        "libraries",
        "audit_points",
        ["risk_point_id"],
        ["id"],
        ondelete="SET NULL",
    )
    if is_pg:
        op.create_index(
            "ix_libraries_risk_point",
            "libraries",
            ["risk_point_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.drop_index("ix_libraries_risk_point", table_name="libraries")
    op.drop_constraint("fk_libraries_risk_point", "libraries", type_="foreignkey")
    op.drop_column("libraries", "risk_point_id")