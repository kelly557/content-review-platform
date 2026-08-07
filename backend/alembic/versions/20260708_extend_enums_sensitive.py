"""extend MaterialStatus enum with 'desensitized' (sensitive-grade materials)

v9 final state:

- ``RiskLevel.SENSITIVE = "敏感"`` is referenced as a string value only;
  it is *not* persisted as a native column type, so no PG ``risklevel``
  enum change is required.
- ``MaterialStatus.DESENSITIZED = "desensitized"`` — sensitive-grade
  materials that have been masked by the desensitization engine.
- ``MaterialStatus.OBSERVE = "observe"`` was added in an earlier draft
  but is no longer used in code (middle-risk materials now go straight
  to REJECTED instead of an observation pool). The PG enum value is
  left in place for backward compatibility with already-migrated DBs
  — PG cannot DROP an enum VALUE, only the whole type.

On PostgreSQL we use ``ALTER TYPE ... ADD VALUE`` (one statement per
new value, must run outside a transaction — Alembic handles this on
PG 12+). On SQLite the enum is stored as VARCHAR with a CHECK
constraint, so we just need to drop and recreate the constraint to
include the new values; SQLAlchemy's ``create_all`` on a fresh DB
already picks them up from the Python enum.

Revision ID: 20260708_extend_enums_sensitive
Revises: e3c9cdaeab15
Create Date: 2026-07-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260708_extend_enums_sensitive"
down_revision = "e3c9cdaeab15"
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


def _pg_add_value(bind, type_name: str, value: str) -> None:
    if bind.dialect.name != "postgresql":
        return
    if value in _enum_values(bind, type_name):
        return
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
    # older PG versions; alembic's autocommit handling covers this on
    # PG 12+ via the standard migration runner.
    op.execute(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{value}'")


def upgrade() -> None:
    bind = op.get_bind()

    # ── MaterialStatus enum (named "materialstatus" on PG) ─────────────
    # Idempotent: skips if the value is already present (e.g. an earlier
    # partial run before the OBSERVE rollback).
    _pg_add_value(bind, "materialstatus", "desensitized")

    # On SQLite the enum check is enforced by SQLAlchemy's auto-generated
    # CHECK constraint. We don't try to mutate it here — fresh DBs built
    # by ``init_db.py`` get the new values automatically, and a manual
    # ``AGREE_RESET=YES`` rebuild is the supported upgrade path for
    # SQLite test instances.


def downgrade() -> None:
    # PG does not support DROP VALUE for an enum type; rollback is a
    # no-op (re-build the database from ``init_db.py`` if needed).
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Best-effort: leave the values in place. Documented limitation.
        pass
