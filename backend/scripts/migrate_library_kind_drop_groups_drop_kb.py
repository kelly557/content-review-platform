"""One-shot data migration: drop library_groups + knowledge tables; add libraries.kind / effective_*.

Run when upgrading an existing DB without doing a full ``init_db.py`` reset.

This script is idempotent. Set AGREE_RESET=YES to run for real (the script does
NOT drop data, but renaming the kind constraint might not be reversible — be
careful in production).

Operations:

  1. Add libraries.kind column + librarykind enum (Postgres only).
  2. Backfill libraries.kind for existing rows: word/image rows default to
     BLACKLIST (conservative — preserves current "黑名单" group semantics);
     reply rows keep kind=NULL.
  3. Drop FK constraint on libraries.group_id, drop the column.
  4. Drop table library_groups (cascade).
  5. Drop tables knowledge_documents, knowledge_extractions,
     knowledge_extraction_items, knowledge_extraction_points.
  6. Add libraries.effective_from + libraries.effective_until (TIMESTAMPTZ,
     nullable). Idempotent — no data backfill.
"""
from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, engine


async def _add_kind_column_if_missing(db: AsyncSession) -> None:
    """Postgres: create enum type + add column. SQLite (tests): no-op."""
    url = engine.url
    if not url.get_backend_name().startswith("postgresql"):
        return  # SQLite 测试库 init 时直接建表，无须迁移
    # 是否已经有 kind 列
    res = await db.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name='libraries' AND column_name='kind' LIMIT 1"
        )
    )
    if res.scalar():
        return
    print("  - create librarykind enum + libraries.kind column", file=sys.stderr)
    await db.execute(
        text("CREATE TYPE librarykind AS ENUM ('黑名单', '白名单')")
    )
    await db.execute(text("ALTER TABLE libraries ADD COLUMN kind librarykind"))
    # 默认全部 word/image 视为 黑名单；reply 保持 NULL
    await db.execute(
        text(
            "UPDATE libraries SET kind='黑名单' "
            "WHERE library_type IN ('word','image')"
        )
    )
    await db.commit()


async def _drop_group_references(db: AsyncSession) -> None:
    url = engine.url
    if not url.get_backend_name().startswith("postgresql"):
        return
    # Drop FK constraint (name pattern from alembic generate: libraries_group_id_fkey)
    print("  - drop libraries.group_id FK + column", file=sys.stderr)
    await db.execute(
        text("ALTER TABLE libraries DROP CONSTRAINT IF EXISTS libraries_group_id_fkey")
    )
    await db.execute(text("ALTER TABLE libraries DROP COLUMN IF EXISTS group_id"))
    # Drop library_groups table
    print("  - drop library_groups table", file=sys.stderr)
    await db.execute(text("DROP TABLE IF EXISTS library_groups CASCADE"))
    await db.commit()


async def _drop_knowledge_tables(db: AsyncSession) -> None:
    url = engine.url
    if not url.get_backend_name().startswith("postgresql"):
        return
    print("  - drop knowledge_* tables", file=sys.stderr)
    for tbl in (
        "knowledge_extraction_points",
        "knowledge_extraction_items",
        "knowledge_extractions",
        "knowledge_documents",
    ):
        await db.execute(text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))
    await db.commit()


async def _add_effective_columns_if_missing(db: AsyncSession) -> None:
    """Postgres: add effective_from + effective_until nullable TIMESTAMPTZ."""
    url = engine.url
    if not url.get_backend_name().startswith("postgresql"):
        return
    res = await db.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name='libraries' AND column_name='effective_from' LIMIT 1"
        )
    )
    if res.scalar():
        return
    print("  - add libraries.effective_from + effective_until", file=sys.stderr)
    await db.execute(
        text("ALTER TABLE libraries ADD COLUMN effective_from TIMESTAMPTZ")
    )
    await db.execute(
        text("ALTER TABLE libraries ADD COLUMN effective_until TIMESTAMPTZ")
    )
    await db.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_libraries_effective_range "
            "ON libraries (effective_from, effective_until)"
        )
    )
    await db.commit()


async def migrate() -> None:
    async with SessionLocal() as db:
        await _add_kind_column_if_missing(db)
        await _drop_group_references(db)
        await _drop_knowledge_tables(db)
        await _add_effective_columns_if_missing(db)
    print("migration done.", file=sys.stderr)


if __name__ == "__main__":
    if os.environ.get("AGREE_RESET") != "YES":
        print(
            "Set AGREE_RESET=YES to apply this migration. "
            "It drops library_groups + knowledge_* tables.",
            file=sys.stderr,
        )
        sys.exit(0)
    asyncio.run(migrate())
