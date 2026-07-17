"""Render bootstrap for fresh vs existing databases.

Strategy:
- Fresh empty DB: create current schema from ORM metadata, stamp alembic head,
  then run one-time seed.
- Existing DB: run normal ``alembic upgrade head`` and never auto-seed.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text

from app.db import Base  # noqa: F401 - imports model registrations
from app.db.session import engine


BACKEND_DIR = Path(__file__).resolve().parent.parent


async def _scalar(sql: str):
    async with engine.connect() as conn:
        return (await conn.execute(text(sql))).scalar_one()


async def _table_exists(table_name: str) -> bool:
    result = await _scalar(
        f"SELECT to_regclass('public.{table_name}') IS NOT NULL"
    )
    return bool(result)


async def _is_fresh_db() -> bool:
    # Treat the DB as fresh only when neither alembic state nor core app tables exist.
    has_alembic = await _table_exists("alembic_version")
    has_users = await _table_exists("users")
    has_strategies = await _table_exists("strategies")
    has_libraries = await _table_exists("libraries")
    return not any((has_alembic, has_users, has_strategies, has_libraries))


async def _create_schema_from_models() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _run(cmd: list[str], *, extra_env: dict[str, str] | None = None) -> None:
    env = os.environ.copy()
    env.setdefault("PYTHONPATH", ".")
    if extra_env:
        env.update(extra_env)
    subprocess.run(cmd, cwd=str(BACKEND_DIR), env=env, check=True)


async def main() -> int:
    try:
        fresh = await _is_fresh_db()
        if fresh:
            print("[bootstrap_render_db] fresh DB detected; create_all + alembic stamp head + seed")
            await _create_schema_from_models()
        else:
            print("[bootstrap_render_db] existing DB detected; alembic upgrade head")
    finally:
        await engine.dispose()

    if fresh:
        _run(["alembic", "stamp", "head"])
        _run(
            [sys.executable, "scripts/seed.py", "--allow-reseed"],
            extra_env={"RESEED_ALLOWED": "YES"},
        )
    else:
        _run(["alembic", "upgrade", "head"])

    _run(
        [
            sys.executable,
            "scripts/repair_default_admins.py",
            "--apply",
            "--reason",
            "render bootstrap ensure default admin accounts",
        ]
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
