"""Fix-1.1 surgery: null out machine_result for tasks containing mock-flavored
hits so re-triggering writes real LLM data.

This is a one-shot maintenance script — kept in scripts/ rather than as a
pure inline SQL because we want the safety net of an explicit Python
wrapper around the multi-line SQL (no shell escaping concerns).

Backward compatibility:
- Tasks whose machine_result contained a hit with service_name starting
  with "Mock" (the old mock detector) OR service_code matching "mock_*"
  / "maas_disabled" / "maas_fallback" (the deprecated double-run paths)
  get their machine_result nulled and machine_status reset to PENDING.
- Tasks with hits from the real MaaS path (service_name="MaaS Moderation"
  or service_code starting with text_detection_pro / image_audit_pro etc.)
  are LEFT UNTOUCHED.
- The original machine_result is dumped to /tmp/adreview-mock-mr-task-<id>.json
  before mutation so the operator can restore if anything looks off.

Run with --dry-run first to preview affected rows::

    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/fix_1_1_clear_mock_machine_results.py --dry-run --reason 'cleanup before v8'
    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/fix_1_1_clear_mock_machine_results.py --apply  --reason 'cleanup before v8'
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy import text

from app.db import Base  # noqa: F401  -- ensure model registration
from app.db.session import SessionLocal


def _require_env(reason: str | None) -> None:
    if os.environ.get("FIX_1_1_ALLOWED") != "YES":
        sys.stderr.write(
            "[fix_1_1] refusing to run: set FIX_1_1_ALLOWED=YES to acknowledge\n"
            "this destructive mutation. Backup dump is written to /tmp.\n"
        )
        sys.exit(1)
    if not reason:
        sys.stderr.write(
            "[fix_1_1] refusing to run: pass --reason '<text>'\n"
        )
        sys.exit(1)


async def _affected_rows(db) -> list[tuple[int, str]]:
    r = await db.execute(
        text(
            """
            SELECT t.id, t.title
            FROM review_tasks t
            WHERE t.machine_result IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(t.machine_result->'hits') AS h
                  WHERE (h->>'service_name') LIKE 'Mock%'
                     OR (h->>'service_code') LIKE 'mock%'
                     OR (h->>'service_code') LIKE 'maas_%'
              )
            ORDER BY t.id
            """
        )
    )
    return [(int(row[0]), str(row[1])) for row in r.all()]


async def _dump_backup(db, task_ids: list[int]) -> None:
    for tid in task_ids:
        r = await db.execute(
            text("SELECT machine_result FROM review_tasks WHERE id = :i"),
            {"i": tid},
        )
        row = r.first()
        if row is None or row[0] is None:
            continue
        Path(f"/tmp/adreview-mock-mr-task-{tid}.json").write_text(str(row[0]))


async def _dry_run() -> int:
    async with SessionLocal() as db:
        rows = await _affected_rows(db)
        total_hits_q = await db.execute(
            text(
                """
                SELECT count(*) FROM review_tasks t, jsonb_array_elements(t.machine_result->'hits') AS h
                WHERE (h->>'service_name') LIKE 'Mock%'
                   OR (h->>'service_code') LIKE 'mock%'
                   OR (h->>'service_code') LIKE 'maas_%'
                """
            )
        )
        total_hits = total_hits_q.scalar()
        print(f"[dry-run] would null out machine_result on {len(rows)} task(s);")
        print(f"[dry-run] total affected hit rows: {total_hits}")
        for tid, title in rows:
            print(f"  - task#{tid} title={title[:60]!r}")
        print(f"[dry-run] backups would write to /tmp/adreview-mock-mr-task-<id>.json")
        return len(rows)


async def _apply() -> int:
    async with SessionLocal() as db:
        rows = await _affected_rows(db)
        await _dump_backup(db, [tid for tid, _ in rows])
        upd = await db.execute(
            text(
                """
                UPDATE review_tasks
                SET machine_result = NULL,
                    machine_status = CAST('PENDING' AS text)::machinestatus,
                    machine_started_at = NULL,
                    machine_completed_at = NULL
                WHERE machine_result IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM jsonb_array_elements(machine_result->'hits') AS h
                      WHERE (h->>'service_name') LIKE 'Mock%'
                         OR (h->>'service_code') LIKE 'mock%'
                         OR (h->>'service_code') LIKE 'maas_%'
                  )
                """
            )
        )
        await db.commit()
        print(f"[apply] cleared machine_result on {upd.rowcount} task(s);")
        print(f"[apply] backups: /tmp/adreview-mock-mr-task-<id>.json")
        return upd.rowcount or 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Null out machine_result for tasks containing mock-flavored hits",
        allow_abbrev=False,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Actually mutate. Default is dry-run.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="(Deprecated: this is the default. Kept for clarity.)",
    )
    p.add_argument("--reason", required=True, help="Audit reason for the run")
    parsed = p.parse_args()
    if parsed.apply and parsed.dry_run:
        p.error("--apply and --dry-run are mutually exclusive; default is dry-run")
    return parsed


if __name__ == "__main__":
    args = _parse_args()
    _require_env(args.reason)

    async def _run() -> None:
        try:
            if args.apply:
                await _apply()
            else:
                await _dry_run()
        finally:
            from app.db.session import engine
            await engine.dispose()

    asyncio.run(_run())
