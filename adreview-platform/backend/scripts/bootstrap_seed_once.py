"""Render-safe one-time seed bootstrap.

Runs only on an empty database. This script is intentionally narrow:

- It does NOT reset schema or drop data.
- It seeds only when core business tables are empty.
- It shells out to ``scripts/seed.py`` with the explicit reseed gate so the
  normal project safety checks still apply.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text

from app.db.session import engine


BACKEND_DIR = Path(__file__).resolve().parent.parent


async def _needs_seed() -> bool:
    query = text(
        "SELECT "
        "  (SELECT count(*) FROM users) + "
        "  (SELECT count(*) FROM strategies) + "
        "  (SELECT count(*) FROM libraries)"
    )
    async with engine.connect() as conn:
        total = (await conn.execute(query)).scalar_one()
    return (total or 0) == 0


def _run_seed() -> None:
    env = os.environ.copy()
    env["RESEED_ALLOWED"] = "YES"
    env.setdefault("PYTHONPATH", ".")
    cmd = [sys.executable, "scripts/seed.py", "--allow-reseed"]
    subprocess.run(cmd, cwd=str(BACKEND_DIR), env=env, check=True)


async def main() -> int:
    try:
        if not await _needs_seed():
            print("[bootstrap_seed_once] non-empty DB detected; skip seed")
            return 0
    finally:
        await engine.dispose()

    print("[bootstrap_seed_once] empty DB detected; running one-time seed")
    _run_seed()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
