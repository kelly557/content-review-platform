"""Daily cleanup job for soft-deleted libraries and items.

Removes library_items older than ``RECYCLE_DAYS`` (default 30). For image
items, the underlying storage object is also deleted. Libraries themselves
remain soft-deleted; full removal happens once their item count is 0 and the
window has elapsed.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.session import SessionLocal
from app.models.library import Library
from app.models.library_item import LibraryItem
from app.services import storage

logger = get_logger(__name__)

RECYCLE_DAYS = 30


async def cleanup_once(session_factory=SessionLocal, recycle_days: int = RECYCLE_DAYS) -> dict:
    """Run one cleanup cycle. Returns counters for visibility/tests."""
    cutoff = datetime.utcnow() - timedelta(days=recycle_days)
    counters = {"items_deleted": 0, "libraries_deleted": 0, "files_deleted": 0}

    async with session_factory() as db:  # type: AsyncSession
        rows = (
            await db.execute(
                select(LibraryItem).where(
                    and_(
                        LibraryItem.is_deleted == True,  # noqa: E712
                        LibraryItem.deleted_at != None,  # noqa: E711
                        LibraryItem.deleted_at < cutoff,
                    )
                )
            )
        ).scalars()
        to_delete = list(rows)
        for it in to_delete:
            if it.storage_key:
                try:
                    storage.delete_object(it.storage_key)
                    counters["files_deleted"] += 1
                except Exception as e:  # noqa: BLE001
                    logger.warning("cleanup: file delete failed for %s: %s", it.storage_key, e)
            await db.delete(it)
            counters["items_deleted"] += 1
        if to_delete:
            await db.commit()

        empty_libs = (
            await db.execute(
                select(Library)
                .where(
                    and_(
                        Library.is_deleted == True,  # noqa: E712
                        Library.deleted_at != None,  # noqa: E711
                        Library.deleted_at < cutoff,
                    )
                )
            )
        ).scalars()
        for lib in list(empty_libs):
            remaining = (
                await db.scalar(
                    select(func.count())
                    .select_from(LibraryItem)
                    .where(LibraryItem.library_id == lib.id)
                )
                or 0
            )
            if remaining == 0:
                await db.delete(lib)
                counters["libraries_deleted"] += 1
        if counters["libraries_deleted"]:
            await db.commit()

    logger.info("library cleanup done: %s", counters)
    return counters


def schedule_daily(loop: Optional[asyncio.AbstractEventLoop] = None) -> asyncio.Task:
    """Schedule daily cleanup at process start; returns the asyncio Task."""

    async def _runner():
        while True:
            try:
                await cleanup_once()
            except Exception as e:  # noqa: BLE001
                logger.exception("cleanup cycle failed: %s", e)
            await asyncio.sleep(24 * 60 * 60)

    return asyncio.create_task(_runner())