"""add superadmin role and libraries.is_platform flag

Adds the ``SUPERADMIN`` value to the ``userrole`` PostgreSQL enum and a new
``is_platform`` boolean column to ``libraries``. The flag distinguishes the
共享/通用平台库 (``is_platform=true``) that only the superadmin role may see
or edit, from regular 个性化 (``is_platform=false``) libraries.

The 18 default seed libraries (lib_w_bad_*, lib_w_politics_*) are backfilled
to ``is_platform=true`` so that non-superadmin users no longer see them by
default. Other newly created libraries default to ``is_platform=false``.

Revision ID: 20260712_add_superadmin_and_library_platform
Revises: 20260710_add_triggers
Create Date: 2026-07-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260712_add_superadmin_and_library_platform"
down_revision = "20260710_add_triggers"
branch_labels = None
depends_on = None


def _enum_values(bind, type_name: str) -> list[str]:
    """Return the current values of a PG enum, or [] on other dialects."""
    if bind.dialect.name != "postgresql":
        return []
    rows = bind.execute(
        sa.text(
            "SELECT enumlabel FROM pg_enum "
            "WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = :name) "
            "ORDER BY enumsortorder"
        ),
        {"name": type_name},
    ).fetchall()
    return [r[0] for r in rows]


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    # ── 1. Add 'SUPERADMIN' to userrole enum (PG only — SQLite uses VARCHAR check) ──
    # NOTE: SQLAlchemy's ``Enum(UserRole)`` defaults to persisting enum names
    # (UPPERCASE), not .value. Existing rows hold 'ADMIN' / 'SUBMITTER' / etc.
    # We must add the matching UPPERCASE label so ORM INSERTs into users.role
    # stay compatible.
    if is_pg and "SUPERADMIN" not in _enum_values(bind, "userrole"):
        # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
        # older PG versions. Alembic handles autocommit for PG 12+ at the
        # migration runner level.
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'SUPERADMIN'")

    # ── 2. Add is_platform column to libraries ──
    op.add_column(
        "libraries",
        sa.Column(
            "is_platform",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_libraries_is_platform",
        "libraries",
        ["is_platform"],
    )

    # ── 3. Backfill default seed libraries as platform (通用) ──
    op.execute(
        "UPDATE libraries "
        "SET is_platform = TRUE "
        "WHERE code LIKE 'lib_w_bad_%' OR code LIKE 'lib_w_politics_%'"
    )


def downgrade() -> None:
    # PG ENUM value 'superadmin' cannot be removed in place — manual rebuild
    # required. Drop the column / index unconditionally.
    op.drop_index("ix_libraries_is_platform", table_name="libraries")
    op.drop_column("libraries", "is_platform")