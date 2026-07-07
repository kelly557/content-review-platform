"""One-shot data migration: word_sets/image_sets → libraries + library_items + library_groups.

Run AFTER alembic upgrade (which created the new tables). Strategy:

  1. Create one LibraryGroup per distinct (word_sets.group, image_sets.group)
     name from old data, plus a fallback "默认分组" if needed.
  2. For each old word_set, create Library(type=WORD, code=ws_<id>, group=matched).
     Each non-empty line in words_text becomes one LibraryItem row.
  3. For each old image_set, create Library(type=IMAGE, code=is_<id>, group=matched).
     Each image_set_item becomes one LibraryItem (storage_key/sha256/...).
  4. Copy audit_points.custom_wordset_id → audit_points.custom_library_id.

Idempotent: re-runs are safe (skip if libraries with matching code exist).
"""
from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.audit_point import AuditPoint
from app.models.imageset import ImageSet, ImageSetItem
from app.models.library import Library, LibraryType
from app.models.library_group import LibraryGroup
from app.models.library_item import LibraryItem
from app.models.wordset import WordSet

DEFAULT_GROUP_NAME = "默认分组"


async def _ensure_group(
    db: AsyncSession, name: str, sort: int
) -> LibraryGroup:
    g = (
        await db.execute(select(LibraryGroup).where(LibraryGroup.name == name))
    ).scalar_one_or_none()
    if g:
        return g
    g = LibraryGroup(name=name, sort_order=sort)
    db.add(g)
    await db.flush()
    await db.refresh(g)
    return g


async def migrate() -> None:
    async with SessionLocal() as db:
        summary = {
            "word_libraries": 0,
            "word_items": 0,
            "image_libraries": 0,
            "image_items": 0,
            "audit_points": 0,
        }

        await _ensure_group(db, DEFAULT_GROUP_NAME, 0)

        # wordsets
        wss = list((await db.execute(select(WordSet))).scalars())
        for ws in wss:
            existing = (
                await db.execute(
                    select(Library).where(Library.code == ws.code)
                )
            ).scalar_one_or_none()
            if existing:
                continue
            grp = await _ensure_group(db, f"迁移-{ws.group.value}", sort=ws.id + 100)
            lib = Library(
                code=ws.code,
                name=ws.name,
                library_type=LibraryType.WORD,
                group_id=grp.id,
                description=ws.description,
                is_active=ws.is_active,
                ignored_services=list(ws.ignored_services or []),
            )
            db.add(lib)
            await db.flush()

            added = 0
            if ws.words_text:
                seen: set[str] = set()
                for line in ws.words_text.splitlines():
                    w = line.strip()
                    if not w or w in seen:
                        continue
                    seen.add(w)
                    db.add(LibraryItem(library_id=lib.id, word=w))
                    added += 1
            summary["word_libraries"] += 1
            summary["word_items"] += added

        # imagesets
        iss = list((await db.execute(select(ImageSet))).scalars())
        for s in iss:
            existing = (
                await db.execute(
                    select(Library).where(Library.code == s.code)
                )
            ).scalar_one_or_none()
            if existing:
                continue
            grp = await _ensure_group(db, f"迁移-{s.group.value}", sort=s.id + 200)
            lib = Library(
                code=s.code,
                name=s.name,
                library_type=LibraryType.IMAGE,
                group_id=grp.id,
                description=s.description,
                is_active=s.is_active,
                ignored_services=list(s.ignored_services or []),
            )
            db.add(lib)
            await db.flush()

            items = list(
                (
                    await db.execute(
                        select(ImageSetItem).where(ImageSetItem.set_id == s.id)
                    )
                ).scalars()
            )
            for it in items:
                db.add(
                    LibraryItem(
                        library_id=lib.id,
                        storage_key=it.storage_key,
                        sha256=it.sha256,
                        original_filename=it.original_filename,
                        mime_type=it.mime_type,
                        file_size=it.file_size,
                    )
                )
            summary["image_libraries"] += 1
            summary["image_items"] += len(items)

        # audit_points.custom_wordset_id -> custom_library_id
        aps = list(
            (await db.execute(select(AuditPoint).where(AuditPoint.custom_wordset_id != None))).scalars()  # noqa: E711
        )
        for ap in aps:
            ap.custom_library_id = ap.custom_wordset_id
            summary["audit_points"] += 1

        await db.commit()
        print("migrate_to_libraries: done", summary, file=sys.stderr)


if __name__ == "__main__":
    if os.environ.get("AGREE_RESET") != "YES":
        print(
            "This script copies word_sets/image_sets data into the new libraries tables.\n"
            "It does NOT drop or modify existing tables. Set AGREE_RESET=YES to run.",
            file=sys.stderr,
        )
        sys.exit(0)
    asyncio.run(migrate())