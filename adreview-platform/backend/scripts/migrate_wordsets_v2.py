"""Migrate existing word_sets / image_sets rows to the new group + action schema.

Old shape:
    kind = "黑名单" | "白名单"

New shape:
    group ∈ {敏感词, 广告法, 品牌, 行业, 合规, 关键词, 清单, 自定义}  -- default 关键词
    action = "黑名单" | "白名单" | "需复审" | "标签"  -- derived from old kind:
        黑名单 → action=黑名单
        白名单 → action=白名单

This script is idempotent: it only writes when group/action is NULL.
Run with ``PYTHONPATH=. python3 scripts/migrate_wordsets_v2.py``.
"""
from __future__ import annotations

import asyncio
from sqlalchemy import select, update

from app.db import Base  # noqa: F401
from app.db.session import SessionLocal, engine
from app.models.imageset import ImageSet, ImageSetAction, ImageSetGroup, ImageSetKind
from app.models.wordset import WordSet, WordSetAction, WordSetGroup, WordSetKind

KIND_TO_ACTION = {
    WordSetKind.BLACKLIST: WordSetAction.BLOCK,
    WordSetKind.WHITELIST: WordSetAction.ALLOW,
}
KIND_TO_GROUP = WordSetGroup.KEYWORD  # 老数据默认归到"关键词"

IMAGE_KIND_TO_ACTION = {
    ImageSetKind.BLACKLIST: ImageSetAction.BLOCK,
    ImageSetKind.WHITELIST: ImageSetAction.ALLOW,
}
IMAGE_KIND_TO_GROUP = ImageSetGroup.KEYWORD


async def migrate() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        # WordSet
        result = await db.execute(select(WordSet))
        wordsets = result.scalars().all()
        ws_updated = 0
        for ws in wordsets:
            if ws.group is None and ws.kind is not None:
                await db.execute(
                    update(WordSet)
                    .where(WordSet.id == ws.id)
                    .values(
                        group=KIND_TO_GROUP,
                        action=KIND_TO_ACTION.get(ws.kind, WordSetAction.BLOCK),
                    )
                )
                ws_updated += 1
        print(f"word_sets: scanned={len(wordsets)} updated={ws_updated}")

        # ImageSet
        result = await db.execute(select(ImageSet))
        imagesets = result.scalars().all()
        is_updated = 0
        for s in imagesets:
            if s.group is None and s.kind is not None:
                await db.execute(
                    update(ImageSet)
                    .where(ImageSet.id == s.id)
                    .values(
                        group=IMAGE_KIND_TO_GROUP,
                        action=IMAGE_KIND_TO_ACTION.get(s.kind, ImageSetAction.BLOCK),
                    )
                )
                is_updated += 1
        print(f"image_sets: scanned={len(imagesets)} updated={is_updated}")

        await db.commit()


if __name__ == "__main__":
    async def _run() -> None:
        try:
            await migrate()
        finally:
            await engine.dispose()

    asyncio.run(_run())
