"""add tags.modality

三级标签「适用模态」字段（text/image/audio/video），仅 level=3 使用；
一/二级为 NULL 表示跨模态共享节点。支撑数美标签体系（图片/文本两套
三级标签挂在共享的一/二级树下）。

Revision ID: 20260813_add_tag_modality
Revises: 20260812_audit_points_parent
Create Date: 2026-08-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "20260813_add_tag_modality"
down_revision = "20260812_audit_points_parent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("modality", sa.String(length=8), nullable=True),
    )
    op.create_index("ix_tags_modality", "tags", ["modality"])


def downgrade() -> None:
    op.drop_index("ix_tags_modality", table_name="tags")
    op.drop_column("tags", "modality")
