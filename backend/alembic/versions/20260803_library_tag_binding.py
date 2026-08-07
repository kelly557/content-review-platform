"""add library_tags: bind a (level 1 / level 2) tag to a word/reply library

A library (word / image / reply) can optionally bind one top-level or
mid-level tag from the existing ``tags`` table. The binding is used by:

  - 词库/代答库新建/编辑: 允许绑定一级/二级标签 (可选)
  - 本地词库匹配 hit 的 label_cn: 不绑时返回「自定义黑名单库/自定义白名单库」;
    绑定时把 tag.path 作为前缀拼在 label_cn 前 (例: 「涉政/一级领导人/自定义黑名单库:xx」)

Schema:
  library_tags
    - library_id  INTEGER  NOT NULL  FK -> libraries.id   ON DELETE CASCADE
    - tag_id      VARCHAR(36) NOT NULL  FK -> tags.id     ON DELETE CASCADE
    - created_at  TIMESTAMP  NOT NULL  DEFAULT now()

Constraints:
  - PRIMARY KEY (library_id, tag_id) — 一个库当前只允许一个绑定，但保留 M2M 表
    形式以便后续扩展为多标签。
  - INDEX (tag_id) — 反查「哪些库绑定了这个 tag」

Revision ID: 20260803_library_tag_binding
Revises: add_tag_cascade_columns
Create Date: 2026-08-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "20260803_library_tag_binding"
down_revision = "add_tag_cascade_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_tags",
        sa.Column(
            "library_id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "tag_id",
            sa.String(length=36),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "library_id",
            "tag_id",
            name="pk_library_tags",
        ),
        sa.ForeignKeyConstraint(
            ["library_id"],
            ["libraries.id"],
            name="fk_library_tags_library",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tag_id"],
            ["tags.id"],
            name="fk_library_tags_tag",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_library_tags_tag_id",
        "library_tags",
        ["tag_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_library_tags_tag_id", table_name="library_tags")
    op.drop_table("library_tags")
