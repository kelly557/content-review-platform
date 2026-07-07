"""One-shot table creation (dev convenience).

Production should use Alembic; this script exists so the scaffold runs without
manually wiring migrations.

WARNING: This script DROPS the entire public schema (CASCADE) before recreating
tables. All data in the database will be lost. To proceed, **both** environment
variables must be set to the exact values shown:

    AGREE_RESET=YES \
    I_UNDERSTAND_DATA_LOSS=I_UNDERSTAND_DATA_LOSS \
    python scripts/init_db.py
"""
import asyncio
import os
import sys

from sqlalchemy.ext.asyncio import AsyncConnection

from app.db import Base  # noqa: F401  -- triggers model registration
from app.db.session import engine


def _check_reset_agreement() -> None:
    """Require explicit, dual confirmation before destructive reset.

    Two independent environment variables must each equal the literal expected
    value. This guards against:
      - typos in one variable (matching is exact)
      - accidental copy-paste of part of one env var
      - short-form `yes` / `true` / `1` (uppercase `YES` only)
    """
    agree = os.environ.get("AGREE_RESET")
    understand = os.environ.get("I_UNDERSTAND_DATA_LOSS")
    if agree == "YES" and understand == "I_UNDERSTAND_DATA_LOSS":
        return
    print("=" * 70, file=sys.stderr)
    print("  DANGER: This script will DROP SCHEMA public CASCADE", file=sys.stderr)
    print("  ALL DATA in the database will be permanently lost.", file=sys.stderr)
    print("", file=sys.stderr)
    print("  To proceed, set BOTH environment variables to the exact values:", file=sys.stderr)
    print('    AGREE_RESET=YES', file=sys.stderr)
    print('    I_UNDERSTAND_DATA_LOSS=I_UNDERSTAND_DATA_LOSS', file=sys.stderr)
    print("", file=sys.stderr)
    print(f"  Currently set: AGREE_RESET={agree!r}, I_UNDERSTAND_DATA_LOSS={understand!r}", file=sys.stderr)
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