"""Render bootstrap for fresh vs existing databases.

Strategy:
- Fresh empty DB: create current schema from ORM metadata, stamp alembic head,
  then run one-time seed.
- Existing DB with valid alembic version: run normal ``alembic upgrade head``.
- Existing DB with partial/broken schema (no alembic version or upgrade fails):
  DROP schema and rebuild from ORM models.
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
    """Fresh = no core tables at all."""
    has_alembic = await _table_exists("alembic_version")
    has_users = await _table_exists("users")
    has_strategies = await _table_exists("strategies")
    has_libraries = await _table_exists("libraries")
    return not any((has_alembic, has_users, has_strategies, has_libraries))


async def _drop_and_rebuild() -> None:
    """DROP public schema and recreate from ORM models (nuclear option)."""
    print("[bootstrap_render_db] DROP SCHEMA public CASCADE + create_all", flush=True)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(Base.metadata.create_all)


async def _create_schema_from_models() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _run(cmd: list[str], *, extra_env: dict[str, str] | None = None) -> None:
    env = os.environ.copy()
    env.setdefault("PYTHONPATH", ".")
    if extra_env:
        env.update(extra_env)
    result = subprocess.run(
        cmd, cwd=str(BACKEND_DIR), env=env,
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"[bootstrap_render_db] COMMAND FAILED: {' '.join(cmd)}", flush=True)
        print(f"[bootstrap_render_db] STDOUT:\n{result.stdout}", flush=True)
        print(f"[bootstrap_render_db] STDERR:\n{result.stderr}", flush=True)
        raise subprocess.CalledProcessError(
            result.returncode, cmd, result.stdout, result.stderr
        )
    if result.stdout.strip():
        print(f"[bootstrap_render_db] {' '.join(cmd)} stdout:\n{result.stdout}", flush=True)
    if result.stderr.strip():
        print(f"[bootstrap_render_db] {' '.join(cmd)} stderr:\n{result.stderr}", flush=True)


async def main() -> int:
    fresh = await _is_fresh_db()
    if fresh:
        print("[bootstrap_render_db] fresh DB; create_all + stamp head + seed")
        await _create_schema_from_models()
    else:
        print("[bootstrap_render_db] existing DB; alembic upgrade head")
    await engine.dispose()

    if fresh:
        _run(["alembic", "stamp", "head"])
        _run(
            [sys.executable, "scripts/seed.py", "--allow-reseed"],
            extra_env={"RESEED_ALLOWED": "YES"},
        )
    else:
        try:
            _run(["alembic", "upgrade", "head"])
        except subprocess.CalledProcessError:
            print("[bootstrap_render_db] alembic upgrade failed; DROP+rebuild from models", flush=True)
            await _drop_and_rebuild()
            _run(["alembic", "stamp", "head"])
            _run(
                [sys.executable, "scripts/seed.py", "--allow-reseed"],
                extra_env={"RESEED_ALLOWED": "YES"},
            )

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
