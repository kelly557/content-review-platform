"""add library reply type + trigger/reply fields

Extends the unified Library model with a third `library_type = 'reply'`
(对话代答短语库). LibraryItem grows two new nullable columns: `trigger`
(matching keyword) and `reply` (the canned response text). The
CheckConstraint is loosened from `(word OR storage_key)` to a three-way
`(word OR storage_key OR reply)` so existing word/image rows continue to
pass while reply-mode rows can store the new shape.

Revision ID: add_library_reply_type
Revises: 20260707_add_libraries_v3
Create Date: 2026-07-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "add_library_reply_type"
down_revision = "20260707_add_libraries_v3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.execute("ALTER TYPE librarytype ADD VALUE IF NOT EXISTS 'reply'")

    op.add_column(
        "library_items",
        sa.Column("trigger", sa.String(length=256), nullable=True),
    )
    op.add_column(
        "library_items",
        sa.Column("reply", sa.Text(), nullable=True),
    )

    op.execute(
        "ALTER TABLE library_items DROP CONSTRAINT IF EXISTS ck_library_items_kind_consistent"
    )
    op.create_check_constraint(
        "ck_library_items_kind_consistent",
        "library_items",
        "(word IS NOT NULL) OR (storage_key IS NOT NULL) OR (reply IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_library_items_kind_consistent",
        "library_items",
        type_="check",
    )
    op.create_check_constraint(
        "ck_library_items_kind_consistent",
        "library_items",
        "(word IS NOT NULL) OR (storage_key IS NOT NULL)",
    )
    op.drop_column("library_items", "reply")
    op.drop_column("library_items", "trigger")