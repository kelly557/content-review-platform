"""Add new tables to an existing database without dropping data.

Use this when introducing a new model that hasn't been migrated yet via Alembic
in production. Safe by design: only runs ``Base.metadata.create_all`` which is
idempotent for tables that already exist.

    PYTHONPATH=. python3 scripts/add_missing_tables.py
"""
from __future__ import annotations

import asyncio

from app.db import Base  # noqa: F401  -- triggers model registration
from app.db.session import engine


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print("tables synced (new tables created if missing).")


if __name__ == "__main__":
    asyncio.run(main())