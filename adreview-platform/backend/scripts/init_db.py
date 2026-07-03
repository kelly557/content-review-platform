"""One-shot table creation (dev convenience).

Production should use Alembic; this script exists so the scaffold runs without
manually wiring migrations.

WARNING: This script DROPS the entire public schema (CASCADE) before recreating
tables. All data in the database will be lost. Set AGREE_RESET=YES to proceed.
"""
import asyncio
import os
import sys

from sqlalchemy.ext.asyncio import AsyncConnection

from app.db import Base  # noqa: F401  -- triggers model registration
from app.db.session import engine


def _check_reset_agreement() -> None:
    """Require explicit confirmation before destructive reset."""
    if os.environ.get("AGREE_RESET") != "YES":
        print("=" * 70, file=sys.stderr)
        print("  DANGER: This script will DROP SCHEMA public CASCADE", file=sys.stderr)
        print("  ALL DATA in the database will be permanently lost.", file=sys.stderr)
        print("", file=sys.stderr)
        print("  To proceed, set environment variable:", file=sys.stderr)
        print("    AGREE_RESET=YES", file=sys.stderr)
        print("=" * 70, file=sys.stderr)
        sys.exit(2)


async def _reset(conn: AsyncConnection) -> None:
    # drop_all needs autocommit to handle circular FK across multiple DDL statements
    await engine.dispose()
    from app.db.session import engine as _e  # noqa: F401


async def main() -> None:
    _check_reset_agreement()

    # Use raw psycopg/asyncpg via DBAPI connection for DROP (CASCADE handles cycles)
    from sqlalchemy import text

    url = engine.url
    assert url.get_backend_name().startswith("postgresql")
    # Drop and recreate using raw SQL with CASCADE
    async with engine.connect() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.commit()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print("tables created.")


if __name__ == "__main__":
    asyncio.run(main())