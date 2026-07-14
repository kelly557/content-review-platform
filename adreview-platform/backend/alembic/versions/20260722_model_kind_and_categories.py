"""model registry: 大/小模型分流 + 小模型分类 + 版本管理增强

- 加列：kind (large/small), small_category (9 类)
- 加列：registered_model_versions.version_label, notes
- 索引：ix_registered_models_kind_category
- 不删旧列
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260722_model_kind_and_categories"
down_revision = "20260721_drop_model_scale_and_meta"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 加 kind 列（不设置 server_default：旧数据由后续脚本回填）
    op.add_column(
        "registered_models",
        sa.Column("kind", sa.String(length=8), nullable=False, server_default="large"),
    )
    op.create_index(
        "ix_registered_models_kind", "registered_models", ["kind"]
    )

    # 2) 加 small_category 列
    op.add_column(
        "registered_models",
        sa.Column("small_category", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_registered_models_small_category", "registered_models", ["small_category"]
    )

    # 3) 加 (kind, small_category) 联合索引
    op.create_index(
        "ix_registered_models_kind_category",
        "registered_models",
        ["kind", "small_category"],
    )

    # 4) registered_model_versions: version_label + notes
    op.add_column(
        "registered_model_versions",
        sa.Column("version_label", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "registered_model_versions",
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registered_model_versions", "notes")
    op.drop_column("registered_model_versions", "version_label")
    op.drop_index("ix_registered_models_kind_category", table_name="registered_models")
    op.drop_index("ix_registered_models_small_category", table_name="registered_models")
    op.drop_index("ix_registered_models_kind", table_name="registered_models")
    op.drop_column("registered_models", "small_category")
    op.drop_column("registered_models", "kind")
