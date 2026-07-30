"""add tag cascade columns

Phase 2: 三级级联标签体系。给 tags 表加：
  - parent_id            自引用（FK → tags.id, ON DELETE CASCADE）
  - level                1=顶级 / 2=二级 / 3=三级
  - bound_model_id       三级标签绑定的模型（FK → registered_models.id, ON DELETE SET NULL）
  - bound_model_kind     'large'|'small'|null（冗余，便于过滤）

历史数据：旧 tag 记录无 parent，全部归为 level=1（顶级标签），不变语义。

Revision ID: add_tag_cascade_columns
Revises: e3c9cdaeab15
Create Date: 2026-07-29 10:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "add_tag_cascade_columns"
down_revision: Union[str, Sequence[str], None] = "20260801_drop_roles_sort_order"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("parent_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "tags",
        sa.Column(
            "level",
            sa.SmallInteger(),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column(
        "tags",
        sa.Column("bound_model_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "tags",
        sa.Column("bound_model_kind", sa.String(length=8), nullable=True),
    )
    op.create_foreign_key(
        "fk_tag_parent",
        "tags",
        "tags",
        ["parent_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_tag_bound_model",
        "tags",
        "registered_models",
        ["bound_model_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_tags_parent_id", "tags", ["parent_id"])
    op.create_index("ix_tags_level", "tags", ["level"])
    op.create_index("ix_tags_bound_model_id", "tags", ["bound_model_id"])


def downgrade() -> None:
    op.drop_index("ix_tags_bound_model_id", table_name="tags")
    op.drop_index("ix_tags_level", table_name="tags")
    op.drop_index("ix_tags_parent_id", table_name="tags")
    op.drop_constraint("fk_tag_bound_model", "tags", type_="foreignkey")
    op.drop_constraint("fk_tag_parent", "tags", type_="foreignkey")
    op.drop_column("tags", "bound_model_kind")
    op.drop_column("tags", "bound_model_id")
    op.drop_column("tags", "level")
    op.drop_column("tags", "parent_id")