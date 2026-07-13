"""Apply the missing DDL from migration 20260715_phase_b_split_strategy.

Earlier I stamped past this revision, which made alembic think it ran,
but the schema changes never executed. Symptom: GET /strategies returns
500 with ``column strategies.rule_set_id does not exist``.

This script re-runs the DDL only (no data migration — that's
``scripts/migrate_phase_b.py``). Safe to re-run: every IF NOT EXISTS
guard below short-circuits if the schema is already in place.

Backward compat:
- Adds ``rule_sets``, ``strategy_points_v2``, ``disposition_rules`` tables
- Adds ``strategies.rule_set_id`` / ``strategies.disposition_rule_id`` FK cols
- Optionally: runs scripts/migrate_phase_b.py for shadow data (skip here)

Run::

    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/fix_apply_phase_b_ddl.py --dry-run --reason '...'
    cd backend && PYTHONPATH=. ./.venv/bin/python scripts/fix_apply_phase_b_ddl.py --apply  --reason '...'
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from sqlalchemy import text

from app.db.session import SessionLocal


def _require_env(reason: str | None) -> None:
    if os.environ.get("PHASE_B_DDL_ALLOWED") != "YES":
        sys.stderr.write(
            "[fix_phase_b_ddl] refusing to run: set PHASE_B_DDL_ALLOWED=YES\n"
            "to acknowledge schema changes.\n"
        )
        sys.exit(1)
    if not reason:
        sys.stderr.write("[fix_phase_b_ddl] refusing to run: pass --reason '<text>'\n")
        sys.exit(1)


async def _snapshot(db) -> dict[str, bool]:
    """Probe which tables/columns are present."""
    out: dict[str, bool] = {}
    for tbl in ("rule_sets", "strategy_points_v2", "disposition_rules"):
        r = await db.execute(
            text(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name=:t)"
            ),
            {"t": tbl},
        )
        out[f"table:{tbl}"] = bool(r.scalar())
    for col in ("rule_set_id", "disposition_rule_id"):
        r = await db.execute(
            text(
                "SELECT EXISTS(SELECT 1 FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name='strategies' AND column_name=:c)"
            ),
            {"c": col},
        )
        out[f"col:strategies.{col}"] = bool(r.scalar())
    return out


async def _dry_run() -> dict[str, bool]:
    async with SessionLocal() as db:
        snap = await _snapshot(db)
    print("[dry-run] schema state:")
    for k, present in snap.items():
        marker = "[present]" if present else "[MISSING — will create]"
        print(f"  {marker} {k}")
    return snap


async def _apply() -> None:
    async with SessionLocal() as db:
        # Read current snapshot for output
        snap_before = await _snapshot(db)
        actions: list[str] = []

        # 1) rule_sets table
        if not snap_before["table:rule_sets"]:
            await db.execute(
                text(
                    """
                    CREATE TABLE rule_sets (
                        id              SERIAL PRIMARY KEY,
                        public_id       VARCHAR(36) UNIQUE NOT NULL,
                        code            VARCHAR(64) NOT NULL,
                        name            VARCHAR(128) NOT NULL,
                        description     TEXT,
                        config          JSONB NOT NULL DEFAULT '{}'::jsonb,
                        is_builtin      BOOLEAN NOT NULL DEFAULT false,
                        is_editable     BOOLEAN NOT NULL DEFAULT true,
                        locked_by_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        locked_at       TIMESTAMP WITH TIME ZONE,
                        created_by_id   INTEGER REFERENCES users(id),
                        created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                        updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                        CONSTRAINT uq_rule_sets_code UNIQUE (code)
                    )
                    """
                )
            )
            await db.execute(
                text("CREATE UNIQUE INDEX ix_rule_sets_public_id ON rule_sets (public_id)")
            )
            actions.append("CREATE TABLE rule_sets + index")

        # 2) strategy_points_v2
        if not snap_before["table:strategy_points_v2"]:
            await db.execute(
                text(
                    """
                    CREATE TABLE strategy_points_v2 (
                        id              SERIAL PRIMARY KEY,
                        public_id       VARCHAR(36) UNIQUE NOT NULL,
                        rule_set_id     INTEGER NOT NULL REFERENCES rule_sets(id) ON DELETE CASCADE,
                        media_type      VARCHAR(16) NOT NULL,
                        item_id         INTEGER NOT NULL REFERENCES audit_items(id) ON DELETE CASCADE,
                        point_id        INTEGER NOT NULL REFERENCES audit_points(id) ON DELETE CASCADE,
                        is_enabled      BOOLEAN NOT NULL DEFAULT true,
                        medium_threshold NUMERIC(5,2),
                        high_threshold   NUMERIC(5,2),
                        linked_library_ids INTEGER[],
                        created_at      TIMESTAMP NOT NULL DEFAULT now(),
                        CONSTRAINT uq_rs_point_v2 UNIQUE (rule_set_id, point_id)
                    )
                    """
                )
            )
            await db.execute(
                text("CREATE INDEX ix_sp_v2_rs ON strategy_points_v2 (rule_set_id)")
            )
            await db.execute(
                text(
                    "CREATE UNIQUE INDEX ix_strategy_points_v2_public_id "
                    "ON strategy_points_v2 (public_id)"
                )
            )
            actions.append("CREATE TABLE strategy_points_v2 + indexes")

        # 3) disposition_rules
        if not snap_before["table:disposition_rules"]:
            await db.execute(
                text(
                    """
                    CREATE TABLE disposition_rules (
                        id              SERIAL PRIMARY KEY,
                        public_id       VARCHAR(36) UNIQUE NOT NULL,
                        code            VARCHAR(64) NOT NULL,
                        name            VARCHAR(128) NOT NULL,
                        description     TEXT,
                        is_enabled      BOOLEAN NOT NULL DEFAULT false,
                        risk_levels     TEXT[] NOT NULL DEFAULT '{}'::text[],
                        sensitive_levels TEXT[] NOT NULL DEFAULT '{}'::text[],
                        review_rule_id  INTEGER REFERENCES workflow_templates(id) ON DELETE SET NULL,
                        sample_ratio    NUMERIC(5,2) DEFAULT 100.0,
                        auto_action_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
                        is_builtin      BOOLEAN NOT NULL DEFAULT false,
                        is_editable     BOOLEAN NOT NULL DEFAULT true,
                        locked_by_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        locked_at       TIMESTAMP WITH TIME ZONE,
                        created_by_id   INTEGER REFERENCES users(id),
                        created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                        updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                        CONSTRAINT uq_disposition_rules_code UNIQUE (code)
                    )
                    """
                )
            )
            await db.execute(
                text(
                    "CREATE UNIQUE INDEX ix_disposition_rules_public_id "
                    "ON disposition_rules (public_id)"
                )
            )
            actions.append("CREATE TABLE disposition_rules + index")

        # 4) strategies.rule_set_id + fk
        if not snap_before["col:strategies.rule_set_id"]:
            await db.execute(
                text("ALTER TABLE strategies ADD COLUMN rule_set_id INTEGER")
            )
            # FK only if rule_sets exists
            if not snap_before["table:rule_sets"]:
                pass  # table created above, FK added next line
            await db.execute(
                text(
                    "ALTER TABLE strategies ADD CONSTRAINT fk_strategies_rule_set "
                    "FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id) ON DELETE RESTRICT"
                )
            )
            await db.execute(
                text("CREATE INDEX ix_strategies_rule_set_id ON strategies (rule_set_id)")
            )
            actions.append("ADD COLUMN strategies.rule_set_id + FK + index")

        if not snap_before["col:strategies.disposition_rule_id"]:
            await db.execute(
                text(
                    "ALTER TABLE strategies ADD COLUMN disposition_rule_id INTEGER"
                )
            )
            await db.execute(
                text(
                    "ALTER TABLE strategies ADD CONSTRAINT fk_strategies_disposition_rule "
                    "FOREIGN KEY (disposition_rule_id) REFERENCES disposition_rules(id) "
                    "ON DELETE RESTRICT"
                )
            )
            await db.execute(
                text(
                    "CREATE INDEX ix_strategies_disposition_rule_id "
                    "ON strategies (disposition_rule_id)"
                )
            )
            actions.append("ADD COLUMN strategies.disposition_rule_id + FK + index")

        if not actions:
            print("[apply] schema already complete; no DDL needed")
            return

        await db.commit()
        print(f"[apply] executed {len(actions)} step(s):")
        for a in actions:
            print(f"  - {a}")

        snap_after = await _snapshot(db)
        print("[apply] post-state:")
        for k, present in snap_after.items():
            marker = "[present]" if present else "[still missing — manual fix required]"
            print(f"  {marker} {k}")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Re-apply missing Phase B DDL",
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
