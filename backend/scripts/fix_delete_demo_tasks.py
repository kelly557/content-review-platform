"""Fix-MOCK: drop the analytics_demo task/material batches seeded by
``scripts/seed_analytics_demo.py`` + the probe LlmCall rows created during
e2e verification.

Conservative scope:
- review_tasks where title starts with ``__ANALYTICS_DEMO__``
- ReviewAssignments on those tasks (cascade)
- Materials/WorkflowNodes/WorkflowInstances tied to those materials (cascade)
- llm_calls rows where task_id is null AND version_id is null (probe rows
  from the recent e2e verification, identifiable by empty FK pointers)

Out of scope (NOT touched by this script):
- review_tasks where title lacks the ``__...__`` prefix, including the
  five ``未命名文案`` tasks created by users id=1 / id=5 through the API —
  those are potentially real user data and require operator confirmation
  before deletion.

Run::

    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/fix_delete_demo_tasks.py --dry-run --reason 'mock data cleanup'
    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/fix_delete_demo_tasks.py --apply  --reason 'mock data cleanup'
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from sqlalchemy import text

from app.db.session import SessionLocal


def _require_env(reason: str | None) -> None:
    if os.environ.get("DELETE_DEMO_ALLOWED") != "YES":
        sys.stderr.write(
            "[delete_demo_tasks] refusing to run: set DELETE_DEMO_ALLOWED=YES\n"
            "to acknowledge this destructive mutation.\n"
        )
        sys.exit(1)
    if not reason:
        sys.stderr.write(
            "[delete_demo_tasks] refusing to run: pass --reason '<text>'\n"
        )
        sys.exit(1)


# Use ``position('__' IN title) = 1`` to match titles that LITERALLY start
# with two underscores. Plain ``LIKE '__%'`` is wrong because ``_`` is the
# LIKE single-char wildcard; backslash-escape form is fragile across
# dialects. position() is unambiguous and works identically on PG + SQLite.


async def _count_prefixed_tasks(db) -> int:
    r = await db.execute(
        text(
            "SELECT count(*) FROM review_tasks WHERE position('__' IN title) = 1"
        ),
    )
    return int(r.scalar() or 0)


async def _count_prefixed_materials(db) -> int:
    r = await db.execute(
        text(
            "SELECT count(*) FROM materials WHERE position('__' IN title) = 1"
        ),
    )
    return int(r.scalar() or 0)


async def _collect_prefixed_material_ids(db) -> list[int]:
    r = await db.execute(
        text("SELECT id FROM materials WHERE position('__' IN title) = 1")
    )
    return [int(row[0]) for row in r.all()]


async def _count_probe_llm_calls(db) -> int:
    """E2E probe rows have task_id IS NULL and version_id IS NULL.

    Production LlmCall rows link back to a task_id. Probe rows from my
    recent fix-1.1 / claude-opus-4-7 verification called moderate() with
    task_id=0/None and so leave the FK NULL.
    """
    r = await db.execute(
        text("SELECT count(*) FROM llm_calls WHERE task_id IS NULL AND version_id IS NULL")
    )
    return int(r.scalar() or 0)


async def _dry_run() -> dict[str, int]:
    async with SessionLocal() as db:
        demo_tasks = await _count_prefixed_tasks(db)
        demo_materials = await _count_prefixed_materials(db)
        probe_llm_calls = await _count_probe_llm_calls(db)
        print("[dry-run] would delete:")
        print(f"  review_tasks           (position('__' IN title) = 1): {demo_tasks}")
        print(f"  materials              (position('__' IN title) = 1): {demo_materials}")
        print(f"  llm_calls              (task_id IS NULL, version_id IS NULL): {probe_llm_calls}")
        print()
        print("[dry-run] NOT touching (5 未命名文案 tasks belonging to users 1 & 5).")
        return {
            "demo_tasks": demo_tasks,
            "demo_materials": demo_materials,
            "probe_llm_calls": probe_llm_calls,
        }


async def _apply() -> dict[str, int]:
    async with SessionLocal() as db:
        # 1. delete probe LlmCall rows (FK orphans)
        r = await db.execute(
            text("DELETE FROM llm_calls WHERE task_id IS NULL AND version_id IS NULL")
        )
        probe_deleted = r.rowcount or 0

        # 2. delete workflow_instance + nodes for the demo materials
        material_ids = await _collect_prefixed_material_ids(db)
        if material_ids:
            r = await db.execute(
                text(
                    "DELETE FROM workflow_nodes WHERE instance_id IN ("
                    "SELECT id FROM workflow_instances WHERE material_id = ANY(:ids))"
                ),
                {"ids": material_ids},
            )
            r = await db.execute(
                text(
                    "DELETE FROM workflow_instances WHERE material_id = ANY(:ids)"
                ),
                {"ids": material_ids},
            )

        # 3. delete assignments linked to demo tasks (will cascade from tasks,
        #    but be explicit for safety)
        r = await db.execute(
            text(
                "DELETE FROM review_assignments WHERE task_id IN ("
                "SELECT id FROM review_tasks WHERE position('__' IN title) = 1)"
            )
        )
        r = await db.execute(
            text(
                "DELETE FROM review_assignment_tags WHERE assignment_id NOT IN ("
                "SELECT id FROM review_assignments)"
            )
        )
        r = await db.execute(
            text(
                "DELETE FROM review_assignment_audit_items WHERE assignment_id NOT IN ("
                "SELECT id FROM review_assignments)"
            )
        )

        # 4. delete demo tasks (cascade rest)
        r = await db.execute(
            text("DELETE FROM review_tasks WHERE position('__' IN title) = 1")
        )
        tasks_deleted = r.rowcount or 0

        # 5. NULL out demo materials.current_version_id first so the
        #    material_versions delete doesn't trip the
        #    materials.current_version_id → material_versions.id FK.
        if material_ids:
            r = await db.execute(
                text(
                    "UPDATE materials SET current_version_id = NULL "
                    "WHERE id = ANY(:ids)"
                ),
                {"ids": material_ids},
            )
            r = await db.execute(
                text("DELETE FROM material_versions WHERE material_id = ANY(:ids)"),
                {"ids": material_ids},
            )

        # 6. delete demo materials
        if material_ids:
            r = await db.execute(
                text("DELETE FROM materials WHERE id = ANY(:ids)"),
                {"ids": material_ids},
            )
            materials_deleted = r.rowcount or 0
        else:
            materials_deleted = 0

        await db.commit()
        print(
            f"[apply] deleted {tasks_deleted} demo tasks, "
            f"{materials_deleted} demo materials, "
            f"{probe_deleted} probe llm_calls"
        )
        return {
            "tasks_deleted": tasks_deleted,
            "materials_deleted": materials_deleted,
            "probe_llm_calls_deleted": probe_deleted,
        }


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Delete __DEMO__-* fixture rows from the database",
        allow_abbrev=False,
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete. Default is dry-run.",
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
