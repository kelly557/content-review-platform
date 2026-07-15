"""small model: modality enum (text | image)

- registered_models：加 modality 列（String(8), nullable=True）
- 历史 small 模型数据回填 modality='text'
- kind='small' 强制 modality NOT NULL；kind='large' 强制 modality IS NULL
- 索引：modality
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260724_small_model_modality"
down_revision = "20260723_provider_split_and_large_category"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 加列（先 nullable）
    op.add_column(
        "registered_models",
        sa.Column("modality", sa.String(length=8), nullable=True),
    )
    op.create_index(
        "ix_registered_models_modality",
        "registered_models",
        ["modality"],
    )

    # 2. 历史小模型回填 modality='text'
    op.execute(
        "UPDATE registered_models "
        "SET modality = 'text' "
        "WHERE kind = 'small' AND modality IS NULL"
    )

    # 3. CHECK 约束：kind=small 必填，kind=large 强制 null
    op.create_check_constraint(
        "ck_registered_models_modality_kind",
        "registered_models",
        "(kind <> 'small' OR modality IS NOT NULL) "
        "AND (kind <> 'large' OR modality IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_registered_models_modality_kind",
        "registered_models",
        type_="check",
    )
    op.drop_index(
        "ix_registered_models_modality",
        table_name="registered_models",
    )
    op.drop_column("registered_models", "modality")