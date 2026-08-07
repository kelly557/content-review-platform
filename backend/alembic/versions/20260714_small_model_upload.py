"""model registry: 小模型上传文件 + max_output_tokens

- 加列：registered_models.max_output_tokens (Integer, nullable)
- 不动 artifact_* 列（已在原表里存在，只是未启用）
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260714_small_model_upload"
down_revision = "20260722_audit_item_model_and_docs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "registered_models",
        sa.Column("max_output_tokens", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registered_models", "max_output_tokens")