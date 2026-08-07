"""add libraries v3: user-customizable groups, library_items, audit_point link

Replaces the hardcoded WordSetGroup / ImageSetGroup enums and the words_text
Text-blob storage with a fully user-driven model:

  library_groups        — user-defined categories (no system groups)
  libraries             — unified word/image library (replaces word_sets + image_sets)
  library_items         — per-row entries (replaces words_text + image_set_items)
  library_item_references — cross-library sharing (N:N)

Also augments audit_points with the correct nullable FK to the new library id,
coexisting with the legacy custom_wordset_id column for one release.

Revision ID: 20260707_add_libraries_v3
Revises: add_rule_hierarchy
Create Date: 2026-07-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "20260707_add_libraries_v3"
down_revision = "add_rule_hierarchy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_pg else sa.JSON()
    json_default = sa.text("'[]'::jsonb") if is_pg else None

    # ─── 1. library_groups ────────────────────────────────────────────────
    op.create_table(
        "library_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=64), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="100",
        ),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=False),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=False),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_library_groups_active_sort",
        "library_groups",
        ["is_deleted", "sort_order"],
    )

    # ─── 2. libraries ─────────────────────────────────────────────────────
    op.create_table(
        "libraries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "library_type",
            postgresql.ENUM(
                "word", "image", name="librarytype", create_type=True
            ),
            nullable=False,
        ),
        sa.Column(
            "group_id",
            sa.Integer(),
            sa.ForeignKey("library_groups.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column(
            "ignored_services",
            json_type,
            nullable=False,
            server_default=json_default,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=False),
            nullable=True,
        ),
        sa.UniqueConstraint("code", name="uq_libraries_code"),
    )
    op.create_index(
        "ix_libraries_type_group_active",
        "libraries",
        ["library_type", "group_id", "is_deleted", "is_active"],
    )

    # ─── 3. library_items ─────────────────────────────────────────────────
    op.create_table(
        "library_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "library_id",
            sa.Integer(),
            sa.ForeignKey("libraries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # word mode
        sa.Column("word", sa.String(length=256), nullable=True),
        # image mode
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(library_id IS NOT NULL)",
            name="ck_library_items_library_required",
        ),
    )
    op.create_index(
        "ix_library_items_library_active",
        "library_items",
        ["library_id", "is_deleted"],
    )
    op.create_index("ix_library_items_word", "library_items", ["word"])
    op.create_index("ix_library_items_sha", "library_items", ["sha256"])

    # ─── 4. library_item_references ───────────────────────────────────────
    op.create_table(
        "library_item_references",
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("library_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "library_id",
            sa.Integer(),
            sa.ForeignKey("libraries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("item_id", "library_id", name="pk_library_item_references"),
    )
    op.create_index(
        "ix_library_item_references_library",
        "library_item_references",
        ["library_id"],
    )

    # ─── 5. audit_points add new FK (parallel to legacy custom_wordset_id) ─
    op.add_column(
        "audit_points",
        sa.Column("custom_library_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_audit_points_custom_library_id",
        "audit_points",
        ["custom_library_id"],
    )
    op.create_foreign_key(
        "fk_audit_point_library",
        "audit_points",
        "libraries",
        ["custom_library_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_audit_point_library", "audit_points", type_="foreignkey")
    op.drop_index("ix_audit_points_custom_library_id", table_name="audit_points")
    op.drop_column("audit_points", "custom_library_id")

    op.drop_index("ix_library_item_references_library", table_name="library_item_references")
    op.drop_table("library_item_references")

    op.drop_index("ix_library_items_sha", table_name="library_items")
    op.drop_index("ix_library_items_word", table_name="library_items")
    op.drop_index("ix_library_items_library_active", table_name="library_items")
    op.drop_table("library_items")

    op.drop_index("ix_libraries_type_group_active", table_name="libraries")
    op.drop_table("libraries")
    op.execute("DROP TYPE IF EXISTS librarytype")

    op.drop_index("ix_library_groups_active_sort", table_name="library_groups")
    op.drop_table("library_groups")