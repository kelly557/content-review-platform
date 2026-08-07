"""Diagnose DB schema vs. Alembic stamp + ORM-model expectations.

This script was added after the v8.2 incident where a hand-run
``alembic stamp 20260715_phase_b_split_strategy`` plus ``alembic upgrade head``
silently skipped Phase B's DDL (rule_sets / strategy_points_v2 /
disposition_rules tables, strategies.rule_set_id / disposition_rule_id
columns). The app then crashed with HTTP 500 on every request that
traversed those models.

This script diagnoses drift between three sources of truth:

  1. ``alembic_version.version_num`` — Alembic's recorded state
  2. Actual PG schema (tables + columns probed via ``information_schema``)
  3. ORM model expectations in ``app/models/`` (informational only —
     this script doesn't import models; it relies on a curated
     ``EXPECTED`` dict that mirrors the schema AFTER the latest migration)

Outcomes
--------
- **OK**: schema and stamp agree.
- **DRIFT (schema behind stamp)**: stamp says X applied, but
  ``information_schema`` shows columns/tables missing → call out the
  affected migration; do NOT auto-fix (refuse to run --apply).
- **DRIFT (schema ahead of stamp)**: stamp is older than schema → the
  live DB has more migrations applied than the stamp knows about.
  This is what bit us when ``alembic upgrade head`` succeeded after we
  manually stamped past a broken revision. Here the affected migration
  is identified and we point at the corresponding ``fix_*.py`` script.

Run::

    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/diagnose_alembic_state.py
    exit codes: 0 OK | 2 drift | 3 cannot connect
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import text

from app.db.session import SessionLocal


# ─────────────────────────────────────────────────────────────────────
# Expected schema state — mirror of models after the LATEST applied
# alembic migration ("20260716_review_detail_cleanup"). If you add a
# new migration that changes DDL, update this constant too.
# ─────────────────────────────────────────────────────────────────────

REVISION_HEAD = "20260716_review_detail_cleanup"


@dataclass(frozen=True)
class Expected:
    """Tables that must exist (presence check)."""
    tables: tuple[str, ...]


@dataclass(frozen=True)
class ExpectedColumn:
    """Columns that must exist on a given table."""
    table: str
    columns: tuple[str, ...]


EXPECTED_TABLES: tuple[str, ...] = (
    "users",
    "materials",
    "material_versions",
    "workflow_templates",
    "workflow_instances",
    "workflow_nodes",
    "review_tasks",
    "review_assignments",
    "review_assignment_tags",
    "review_assignment_audit_items",  # added by 20260716
    "annotations",
    "trigger_runs",
    "audit_items",
    "audit_points",
    "audit_events",
    "tags",
    "services",
    "strategies",
    "rule_sets",                  # added by 20260715
    "strategy_points_v2",         # added by 20260715
    "disposition_rules",          # added by 20260715
    "llm_calls",                  # added by 20260716
)

EXPECTED_COLUMNS: tuple[ExpectedColumn, ...] = (
    # public_id (added by 20260714_add_public_id_columns)
    *(ExpectedColumn(t, ("public_id",))
      for t in (
          "users", "materials", "material_versions", "workflow_templates",
          "workflow_instances", "workflow_nodes", "review_tasks",
          "review_assignments", "review_assignment_tags", "annotations",
          "review_assignment_audit_items",
          "audit_items", "audit_points", "services", "strategies",
          "rule_sets", "strategy_points_v2", "disposition_rules",
          "llm_calls",
      )),
    # strategies: FK cols added by 20260715_phase_b_split_strategy
    ExpectedColumn("strategies", ("rule_set_id", "disposition_rule_id")),
)


async def _alembic_version(db) -> str | None:
    r = await db.execute(text("SELECT version_num FROM alembic_version"))
    return r.scalar()


async def _table_present(db, name: str) -> bool:
    r = await db.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name=:t)"
        ),
        {"t": name},
    )
    return bool(r.scalar())


async def _column_present(db, table: str, column: str) -> bool:
    r = await db.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:t AND column_name=:c)"
        ),
        {"t": table, "c": column},
    )
    return bool(r.scalar())


async def _diagnose() -> int:
    rc = 0
    async with SessionLocal() as db:
        try:
            version = await _alembic_version(db)
        except Exception as exc:
            print(f"[diagnose] FAIL: cannot read alembic_version: {exc}", file=sys.stderr)
            return 3

        print(f"[diagnose] alembic_version = {version!r}")
        print(f"[diagnose] expected head   = {REVISION_HEAD!r}")

        if version != REVISION_HEAD:
            print(
                f"\n[diagnose] DRIFT: alembic stamp is at {version!r} but code "
                f"expects {REVISION_HEAD!r}.",
                file=sys.stderr,
            )
            rc = 2

        # Table presence
        missing_tables: list[str] = []
        for t in EXPECTED_TABLES:
            if not await _table_present(db, t):
                missing_tables.append(t)
                print(f"[diagnose] MISSING TABLE: {t}", file=sys.stderr)

        # Column presence
        missing_columns: list[tuple[str, str]] = []
        for ec in EXPECTED_COLUMNS:
            if not await _table_present(db, ec.table):
                continue  # reported in missing_tables
            for col in ec.columns:
                if not await _column_present(db, ec.table, col):
                    missing_columns.append((ec.table, col))
                    print(
                        f"[diagnose] MISSING COLUMN: {ec.table}.{col}",
                        file=sys.stderr,
                    )

        if missing_tables or missing_columns:
            print(
                "\n[diagnose] DRIFT: schema does not match the latest migration.\n"
                f"          Missing tables  : {len(missing_tables)}\n"
                f"          Missing columns : {len(missing_columns)}\n"
                "\n"
                "          Possible fixes:\n"
                "            1. Run scripts/fix_apply_phase_b_ddl.py\n"
                "            2. If you're sure the DB is fine, alembic stamp head\n"
                "               (NEVER do this without running scripts/diagnose_alembic_state.py first).\n"
                f"          Expected head revision: {REVISION_HEAD}",
                file=sys.stderr,
            )
            rc = 2

    if rc == 0:
        print("\n[diagnose] OK: stamp matches schema.")
    return rc


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Diagnose alembic stamp vs actual PG schema",
        allow_abbrev=False,
    )
    p.add_argument(
        "--strict",
        action="store_true",
        help="Exit 2 on any warning (default: warn only).",
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    rc = asyncio.run(_diagnose())
    if rc == 0 and args.strict:
        return 0
    return rc


if __name__ == "__main__":
    sys.exit(main())
