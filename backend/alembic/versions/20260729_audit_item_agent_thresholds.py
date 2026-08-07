"""audit_items: add 3 shared threshold columns for review agent items

Revision ID: 20260729_audit_item_agent_thresholds
Revises: 20260728_audit_item_small_category
Create Date: 2026-07-29

- 加 3 列供"自定义 item 作审核 Agent 用"场景共享阈值:
  * low_threshold_min     Float, nullable, default 0
  * medium_threshold_min   Float, nullable, default 60
  * high_threshold_min    Float, nullable, default 90
- 不加 max 列(按现有规则:相邻 min - 0.01 自动反推,服务端校验)
- 仅 is_builtin=false 的 item 会在 API 层被允许写入;
  内置规则继续走 audit_points 表的单 point 阈值路径,不动这些列。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260729_audit_item_agent_thresholds"
down_revision = "20260728_audit_item_small_category"
branch_labels = None
depends_on = None

TABLE = "audit_items"
COLS = [
    ("low_threshold_min", 0.0),
    ("medium_threshold_min", 60.0),
    ("high_threshold_min", 90.0),
]


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns(TABLE)}
    for col, default in COLS:
        if col not in existing:
            op.add_column(
                TABLE,
                sa.Column(col, sa.Float(), nullable=True, server_default=str(default)),
            )


def downgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns(TABLE)}
    for col, _ in COLS:
        if col in existing:
            op.drop_column(TABLE, col)