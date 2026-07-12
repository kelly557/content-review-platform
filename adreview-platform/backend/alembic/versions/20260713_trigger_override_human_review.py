"""add override_human_review to triggers

Trigger 级 step-3 处置覆盖：cron 触发时与 strategy.definition.human_review 字段级合并。
非空字段覆盖策略默认值；空字段走 strategy。

下游流程：
- trigger.run() -> trigger_engine.handle_trigger_run -> merge_human_review
- 合并后写入 WorkflowInstance.strategy_human_review 快照
- 不影响 strategy 本身，仅影响由该 trigger 创建的 workflow instance

Revision ID: 20260713_trigger_override_human_review
Revises: 20260712_add_superadmin_and_library_platform
Create Date: 2026-07-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "20260713_trigger_override_human_review"
down_revision = "20260712_add_superadmin_and_library_platform"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "triggers",
        sa.Column(
            "override_human_review",
            JSONB,
            nullable=True,
            comment="触发器级 step-3 处置覆盖；cron 触发时与 strategy 合并",
        ),
    )


def downgrade() -> None:
    op.drop_column("triggers", "override_human_review")