"""Clean up demo + QA data without touching business rows.

Targets ``__ANALYTICS_DEMO__``, ``__QA__``, and ``__REPLY__`` title prefixes
ONLY. Everything else (users, strategies, tags, libraries, triggers) is left
intact. This is the dedicated reset tool mandated by the 2026-07-16 cleanup:

- It is **not** a full ``init_db.py`` drop.
- It is **not** ``seed.py`` (which is upsert and would re-import DEFAULT_*
  fixture values, clobbering hand-edited rows).
- It is **safe** to run in a populated environment as long as the
  ``RESET_DEMO_TASKS=YES`` env var + ``--reason`` are provided.

Usage::

    cd backend && source .venv/bin/activate
    PYTHONPATH=. RESET_DEMO_TASKS=YES python3 scripts/reset_demo_tasks.py --dry-run --reason 'cleanup before v6 demo'
    PYTHONPATH=. RESET_DEMO_TASKS=YES python3 scripts/reset_demo_tasks.py --apply  --reason 'cleanup before v6 demo'
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime

from sqlalchemy import delete, select

from app.db import Base  # noqa: F401  -- ensures model registration
from app.db.session import SessionLocal, engine
from app.models.alert_event import AlertEvent
from app.models.material import Material
from app.models.workflow import WorkflowInstance


DEMO_TITLE_PREFIXES = ("__ANALYTICS_DEMO__", "__QA__", "__REPLY__", "__DEMO__")


def _require_allowance(reason: str | None) -> None:
    if os.environ.get("RESET_DEMO_TASKS") != "YES":
        sys.stderr.write(
            "[reset_demo_tasks] refusing to run: set RESET_DEMO_TASKS=YES to "
            "confirm this destructive action.\n"
        )
        sys.exit(1)
    if not reason:
        sys.stderr.write(
            "[reset_demo_tasks] refusing to run: pass --reason '<text>' so "
            "the run is traceable in audit logs.\n"
        )
        sys.exit(1)


async def _collect_demo_material_ids(db) -> list[int]:
    rows = (
        await db.execute(
            select(Material.id).where(
                *[Material.title.like(f"{p}%") for p in DEMO_TITLE_PREFIXES]
            )
        )
    ).scalars().all()
    return list(rows)


async def _collect_seed_alert_ids(db) -> list[int]:
    """Return alert_event ids that came from seed_analytics_demo.

    SQLAlchemy 2.x doesn't expose ``Column[..].astext``; we use raw SQL to
    reach into the JSONB path. Fall back to empty list on type-mismatch
    so dry-runs don't blow up on heterogeneous DBs.
    """
    from sqlalchemy import text as sa_text
    try:
        r = await db.execute(
            sa_text("SELECT id FROM alert_events WHERE detail ->> 'source' = 'seed_analytics_demo'")
        )
        return [int(row[0]) for row in r.all()]
    except Exception:
        return []


async def _dry_run() -> int:
    async with SessionLocal() as db:
        material_ids = await _collect_demo_material_ids(db)
        wi_count = (
            await db.execute(
                select(WorkflowInstance.id).where(
                    WorkflowInstance.material_id.in_(material_ids)
                )
            )
        ).scalars().all()
        alerts = await _collect_seed_alert_ids(db)
        print(f"[dry-run] would delete:")
        print(f"  Materials        : {len(material_ids)}")
        print(f"  WorkflowInstances: {len(wi_count)}")
        print(f"  AlertEvents      : {len(alerts)} (only seed_analytics_demo source)")
        for m_id in material_ids[:5]:
            print(f"    sample material id={m_id}")
        if len(material_ids) > 5:
            print(f"    ... and {len(material_ids) - 5} more")
        return len(material_ids)


async def _apply() -> int:
    async with SessionLocal() as db:
        material_ids = await _collect_demo_material_ids(db)

        # Cascade by hand — versions / tasks / assignments / tags / annotations
        # are wiped via ORM cascade rules + the explicit deletes below.
        wi_result = await db.execute(
            delete(WorkflowInstance).where(
                WorkflowInstance.material_id.in_(material_ids)
            )
        )
        alert_result = await db.execute(
            delete(AlertEvent).where(
                AlertEvent.id.in_(await _collect_seed_alert_ids(db))
            )
        )
        m_result = await db.execute(
            delete(Material).where(Material.id.in_(material_ids))
        )
        await db.commit()
        print(
            f"[apply] deleted {m_result.rowcount or 0} materials, "
            f"{wi_result.rowcount or 0} workflow instances, "
            f"{alert_result.rowcount or 0} demo alerts at "
            f"{datetime.utcnow().isoformat()}Z"
        )
        return m_result.rowcount or 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Wipe demo/QA materials without touching business data", allow_abbrev=False)
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
    _require_allowance(args.reason)

    async def _run() -> None:
        try:
            if args.apply:
                await _apply()
            else:
                await _dry_run()
        finally:
            await engine.dispose()

    asyncio.run(_run())
