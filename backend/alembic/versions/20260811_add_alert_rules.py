"""add alert_rules

异常检测规则配置表（前端 anomalyThresholds 持久化）。

Revision ID: 20260811_add_alert_rules
Revises: 20260811_add_review_agents
Create Date: 2026-08-11
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260811_add_alert_rules"
down_revision = "20260811_add_review_agents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_code", sa.String(64), nullable=False, unique=True),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("metric", sa.String(64), nullable=False),
        sa.Column("dimension", sa.String(64), nullable=False, server_default="全局"),
        sa.Column("algorithm", sa.String(64), nullable=False, server_default="固定阈值"),
        sa.Column("window_label", sa.String(64), nullable=False, server_default="近 1 小时"),
        sa.Column("critical", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("warn", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("extra_conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source", sa.String(16), nullable=False, server_default="default"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_alert_rules_rule_code", "alert_rules", ["rule_code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_alert_rules_rule_code", table_name="alert_rules")
    op.drop_table("alert_rules")
