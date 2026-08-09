"""add strategy_tag_refs

策略-标签引用关联表（替代 tag.py 的 _MOCK_STRATEGY_REFS 固定映射）。

Revision ID: 20260812_add_strategy_tag_refs
Revises: 20260811_add_alert_rules
Create Date: 2026-08-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "20260812_add_strategy_tag_refs"
down_revision = "20260811_add_alert_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "strategy_tag_refs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "strategy_id",
            sa.Integer(),
            sa.ForeignKey("strategies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tag_id",
            sa.String(36),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_strategy_tag_refs_strategy_id", "strategy_tag_refs", ["strategy_id"])
    op.create_index("ix_strategy_tag_refs_tag_id", "strategy_tag_refs", ["tag_id"])
    # 唯一约束：同一策略同一标签只记一条
    op.create_unique_constraint(
        "uq_strategy_tag_refs_strategy_tag", "strategy_tag_refs", ["strategy_id", "tag_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_strategy_tag_refs_strategy_tag", "strategy_tag_refs", type_="unique")
    op.drop_index("ix_strategy_tag_refs_tag_id", table_name="strategy_tag_refs")
    op.drop_index("ix_strategy_tag_refs_strategy_id", table_name="strategy_tag_refs")
    op.drop_table("strategy_tag_refs")
