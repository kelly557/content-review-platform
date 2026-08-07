"""Phase B: split strategy into rule_sets + disposition_rules.

引入 3 张新表 (rule_sets, strategy_points_v2, disposition_rules)，
给 strategies 加 rule_set_id / disposition_rule_id 两个 FK 列。

PR B1 仅做 DDL + relationship 出口；不改任何业务 service。
strategies.definition 旧字段全保留作为回退阅读通道，
strategies.rule_set_id / disposition_rule_id 允许 NULL 直至 PR B3 接管。

数据迁移（rule_set / disposition / inline override 影子记录）
单独由 scripts/migrate_phase_b.py 处理，不嵌进 alembic。

Revision ID: 20260715_phase_b_split_strategy
Revises: 20260714_add_public_id_columns, drop_human_review_notify_plan, drop_tag_source
Create Date: 2026-07-15
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB


revision: str = "20260715_phase_b_split_strategy"
down_revision: Union[str, Sequence[str], None] = (
    "20260714_add_public_id_columns",
    "drop_human_review_notify_plan",
    "drop_tag_source",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1) rule_sets ─────────────────────────────────────────────
    op.create_table(
        "rule_sets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "public_id",
            sa.String(length=36),
            unique=True,
            nullable=False,
        ),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "config",
            JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "is_editable",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "locked_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("code", name="uq_rule_sets_code"),
    )
    op.create_index("ix_rule_sets_public_id", "rule_sets", ["public_id"], unique=True)

    # ── 2) strategy_points_v2 ───────────────────────────────────
    op.create_table(
        "strategy_points_v2",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "public_id",
            sa.String(length=36),
            unique=True,
            nullable=False,
        ),
        sa.Column(
            "rule_set_id",
            sa.Integer(),
            sa.ForeignKey("rule_sets.id", ondelete="CASCADE"),
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
            server_default=sa.text("true"),
        ),
        sa.Column("medium_threshold", sa.Numeric(5, 2), nullable=True),
        sa.Column("high_threshold", sa.Numeric(5, 2), nullable=True),
        sa.Column("linked_library_ids", ARRAY(sa.Integer), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("rule_set_id", "point_id", name="uq_rs_point_v2"),
    )
    op.create_index(
        "ix_sp_v2_rs", "strategy_points_v2", ["rule_set_id"]
    )
    op.create_index(
        "ix_strategy_points_v2_public_id",
        "strategy_points_v2",
        ["public_id"],
        unique=True,
    )

    # ── 3) disposition_rules ────────────────────────────────────
    op.create_table(
        "disposition_rules",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "public_id",
            sa.String(length=36),
            unique=True,
            nullable=False,
        ),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "risk_levels",
            ARRAY(sa.String),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column(
            "sensitive_levels",
            ARRAY(sa.String),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column(
            "review_rule_id",
            sa.Integer(),
            sa.ForeignKey("workflow_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "sample_ratio",
            sa.Numeric(5, 2),
            nullable=True,
            server_default=sa.text("100.0"),
        ),
        sa.Column(
            "auto_action_overrides",
            JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "is_editable",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "locked_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("code", name="uq_disposition_rules_code"),
    )
    op.create_index(
        "ix_disposition_rules_public_id",
        "disposition_rules",
        ["public_id"],
        unique=True,
    )

    # ── 4) strategies 加 FK 列 + 索引 ───────────────────────────
    op.add_column(
        "strategies",
        sa.Column(
            "rule_set_id",
            sa.Integer(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_strategies_rule_set",
        "strategies",
        "rule_sets",
        ["rule_set_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_strategies_rule_set_id", "strategies", ["rule_set_id"]
    )

    op.add_column(
        "strategies",
        sa.Column(
            "disposition_rule_id",
            sa.Integer(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_strategies_disposition_rule",
        "strategies",
        "disposition_rules",
        ["disposition_rule_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_strategies_disposition_rule_id",
        "strategies",
        ["disposition_rule_id"],
    )


def downgrade() -> None:
    # ── strategies 新列（倒序） ─────────────────────────────────
    op.drop_index(
        "ix_strategies_disposition_rule_id", table_name="strategies"
    )
    op.drop_constraint(
        "fk_strategies_disposition_rule",
        "strategies",
        type_="foreignkey",
    )
    op.drop_column("strategies", "disposition_rule_id")

    op.drop_index("ix_strategies_rule_set_id", table_name="strategies")
    op.drop_constraint(
        "fk_strategies_rule_set", "strategies", type_="foreignkey"
    )
    op.drop_column("strategies", "rule_set_id")

    # ── 三张新表（倒序） ────────────────────────────────────────
    op.drop_index(
        "ix_disposition_rules_public_id", table_name="disposition_rules"
    )
    op.drop_table("disposition_rules")

    op.drop_index(
        "ix_strategy_points_v2_public_id", table_name="strategy_points_v2"
    )
    op.drop_index("ix_sp_v2_rs", table_name="strategy_points_v2")
    op.drop_table("strategy_points_v2")

    op.drop_index("ix_rule_sets_public_id", table_name="rule_sets")
    op.drop_table("rule_sets")
