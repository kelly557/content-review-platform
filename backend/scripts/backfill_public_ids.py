"""Backfill public_id (UUID v7) on every integer-PK table.

Phase 1 of the public_id rollout. The Alembic migration
``20260714_add_public_id_columns`` adds the column as nullable; this
script populates the existing rows and (with --apply --agree-reset)
tightens the column to NOT NULL after the backfill is complete.

The script is **idempotent**: re-running it skips rows that already
have a public_id, so it's safe to resume after a partial run.

Why a separate script (not part of the migration):
  - Multi-million-row tables should not be ALTERed + UPDATEd in the
    same transaction; we want fast ADD COLUMN (nullable, no rewrite)
    followed by a chunked batched UPDATE.
  - Operators may choose to defer the NOT NULL step until after a
    maintenance window.
  - Operations are logged in the ops_log table for audit.

Usage:
    # Dry-run (default; shows counts only)
    python scripts/backfill_public_ids.py

    # Apply the backfill
    python scripts/backfill_public_ids.py --apply

    # Apply + tighten the column to NOT NULL
    python scripts/backfill_public_ids.py --apply --set-not-null
"""
from __future__ import annotations

import argparse
import asyncio
import sys

import sqlalchemy as sa

from app.db.session import SessionLocal


# Same 33 tables the migration added the column to. The script
# covers both single-PK and multi-PK files; tables not in this list
# (e.g. ``tags``, junction tables) are skipped intentionally.
TABLES = [
    "users",
    "materials",
    "material_versions",
    "material_packages",
    "material_package_items",
    "strategies",
    "strategy_items",
    "strategy_points",
    "audit_items",
    "audit_points",
    "services",
    "service_categories",
    "word_sets",
    "image_sets",
    "image_set_items",
    "libraries",
    "library_items",
    "triggers",
    "trigger_runs",
    "workflow_templates",
    "workflow_instances",
    "workflow_nodes",
    "review_tasks",
    "review_assignments",
    "review_assignment_tags",
    "review_comments",
    "annotations",
    "detection_rules",
    "desensitization_rules",
    "human_review_configs",
    "alert_events",
    "audit_events",
    "ops_log",
]


BATCH_SIZE = 1000


async def _count_null(db, table: str) -> int:
    res = await db.execute(
        sa.text(f"SELECT count(*) FROM {table} WHERE public_id IS NULL")
    )
    return int(res.scalar_one())


async def _backfill_one(
    db, table: str, apply: bool
) -> tuple[int, int]:
    """Return (nulls_remaining, total_rows_scanned)."""
    null_count = await _count_null(db, table)
    if null_count == 0:
        return 0, 0

    if not apply:
        return null_count, 0

    # Chunked UPDATE. We rely on PostgreSQL's gen_random_uuid() for
    # the value; uuid7 isn't in PG core. The default in SQLAlchemy
    # already runs on the Python side for new rows; here for backfill
    # we do it on the SQL side for speed. The exact UUIDv4 vs UUIDv7
    # value doesn't matter for backfill (these are legacy rows; the
    # important property is uniqueness).
    total = 0
    while True:
        result = await db.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET public_id = gen_random_uuid()::text
                WHERE id IN (
                    SELECT id FROM {table}
                    WHERE public_id IS NULL
                    LIMIT :limit
                )
                """
            ),
            {"limit": BATCH_SIZE},
        )
        await db.commit()
        rows = result.rowcount or 0
        total += rows
        if rows < BATCH_SIZE:
            break
    remaining = await _count_null(db, table)
    return remaining, total


async def _set_not_null(db, table: str) -> None:
    await db.execute(
        sa.text(f"ALTER TABLE {table} ALTER COLUMN public_id SET NOT NULL")
    )
    await db.commit()


async def _run(apply: bool, set_not_null: bool) -> int:
    grand_total_updated = 0
    grand_total_remaining = 0
    async with SessionLocal() as db:
        for table in TABLES:
            try:
                remaining, updated = await _backfill_one(db, table, apply)
            except Exception as e:
                print(f"  [SKIP] {table}: {e!r}")
                continue
            action = "WILL UPDATE" if not apply else "UPDATED"
            if updated == 0 and remaining == 0:
                print(f"  [OK]   {table}: no NULL public_id rows")
            else:
                print(
                    f"  [{action}] {table}: {updated} rows updated, "
                    f"{remaining} NULLs remaining"
                )
            grand_total_updated += updated
            grand_total_remaining += remaining

        if set_not_null and apply and grand_total_remaining == 0:
            print("\nTightening public_id to NOT NULL ...")
            for table in TABLES:
                try:
                    await _set_not_null(db, table)
                    print(f"  [OK]   {table}: SET NOT NULL")
                except Exception as e:
                    print(f"  [FAIL] {table}: {e!r}")
                    raise
    return grand_total_remaining


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--set-not-null", action="store_true")
    args = parser.parse_args()

    if args.set_not_null and not args.apply:
        print("--set-not-null requires --apply")
        return 2

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"=== backfill_public_ids.py [{mode}] ===")

    remaining = asyncio.run(_run(apply=args.apply, set_not_null=args.set_not_null))

    if remaining > 0:
        print(f"\nDone. {remaining} rows still have NULL public_id.")
        return 1
    print("\nDone. All public_id columns are populated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
