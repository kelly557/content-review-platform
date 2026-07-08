"""add strategy_points table (point-level enable for strategies)

策略步骤 2 支持「item 级别 + point 级别」细粒度选择：
- 新表 strategy_points(strategy_id, media_type, item_id, point_id, is_enabled)
- 旧策略回填：对于所有已启用的 item，自动展开为「该 item 下所有系统启用的
  point 视为启用」(is_enabled=true)，保证历史策略行为不变。

Revision ID: 20260708_strategy_points
Revises: 20260708_extend_enums_sensitive
Create Date: 2026-07-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260708_strategy_points"
down_revision = "20260708_extend_enums_sensitive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "strategy_points",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "strategy_id",
            sa.Integer(),
            sa.ForeignKey("strategies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("media_type", sa.String(length=16), nullable=False),
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("audit_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "point_id",
            sa.Integer(),
            sa.ForeignKey("audit_points.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("strategy_id", "point_id", name="uq_strategy_point"),
    )
    op.create_index(
        "ix_strategy_points_strategy",
        "strategy_points",
        ["strategy_id"],
    )

    # 回填：旧策略下「已启用 item」对应「item 下系统启用的 point」全部置为 true
    # 这样历史策略在 UI 上重新加载时表现为 item 全开 / point 全开，与改造前一致。
    # 该 INSERT 用 ON CONFLICT DO NOTHING 兜底重复键（理论上不会，但更稳）。
    bind.execute(
        sa.text(
            """
            INSERT INTO strategy_points
                (strategy_id, media_type, item_id, point_id, is_enabled, created_at)
            SELECT
                si.strategy_id,
                si.media_type,
                si.item_id,
                p.id,
                TRUE,
                NOW()
            FROM strategy_items si
            JOIN audit_points p
              ON p.item_id = si.item_id
            WHERE si.is_enabled = TRUE
              AND p.is_enabled = TRUE
            ON CONFLICT (strategy_id, point_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_strategy_points_strategy", table_name="strategy_points")
    op.drop_table("strategy_points")
