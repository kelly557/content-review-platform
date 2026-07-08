"""drop strategy.priority column and ix_strategy_priority_active index

v11 清理过度设计：原 priority 字段从未被 runtime 实际使用，但 index
`ix_strategy_priority_active` 是为不存在的"按 priority 选策略"功能
预先建的索引。两者一并删除以减少误导。

Revision ID: 20260708_drop_strategy_priority
Revises: 20260708_strategy_points
Create Date: 2026-07-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260708_drop_strategy_priority"
down_revision = "20260708_strategy_points"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_strategy_priority_active", table_name="strategies")
    op.drop_column("strategies", "priority")


def downgrade() -> None:
    op.add_column(
        "strategies",
        sa.Column(
            "priority",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index(
        "ix_strategy_priority_active",
        "strategies",
        ["priority", "is_active"],
    )
