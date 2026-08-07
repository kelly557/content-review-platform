"""Seed risk category — 把 9 行内置风险类型写入 risk_categories 表。

为什么独立成脚本：避免触动 seed.py 既有 800 多行（CLAUDE.md 强调：seed.py 即使
非 purge 也是 idempotent upsert，会盖写手工调过的 ``is_builtin`` / ``color`` /
``sort_order``）。本脚本独立运行，先查再 upsert；用户手工改过的内置项会被尊重。
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.risk_category import RiskCategory


DEFAULT_RISK_CATEGORIES: List[Dict[str, Any]] = [
    {"code": "politics",   "label": "涉政",   "color": "red",     "sort_order": 0},
    {"code": "terrorism",  "label": "涉恐",   "color": "red",     "sort_order": 1},
    {"code": "porn",       "label": "涉黄",   "color": "red",     "sort_order": 2},
    {"code": "illicit",    "label": "违禁",   "color": "red",     "sort_order": 3},
    {"code": "ad",         "label": "广告",   "color": "orange",  "sort_order": 4},
    {"code": "religion",   "label": "宗教",   "color": "orange",  "sort_order": 5},
    {"code": "ad_law",     "label": "广告法", "color": "orange",  "sort_order": 6},
    {"code": "abuse",      "label": "辱骂",   "color": "volcano", "sort_order": 7},
    {"code": "unhealthy",  "label": "不良",   "color": "volcano", "sort_order": 8},
]


async def upsert_risk_categories(db: AsyncSession) -> int:
    """仅 upsert；用户手工改过的 label/color 不动（保留为 None 检查）。"""
    created = 0
    for c in DEFAULT_RISK_CATEGORIES:
        existing = (
            await db.execute(
                select(RiskCategory).where(RiskCategory.code == c["code"])
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                RiskCategory(
                    code=c["code"],
                    label=c["label"],
                    color=c["color"],
                    sort_order=c["sort_order"],
                    is_builtin=True,
                )
            )
            created += 1
        else:
            # 仅当用户从未修改过 label/color（is_builtin 仍为 True）才同步默认值；
            # 一旦用户改过 label/color，is_builtin 仍为 True 但 label/color 已偏离，
            # 不再覆盖。
            if existing.is_builtin and existing.label == c["label"] and existing.color == c["color"]:
                existing.sort_order = c["sort_order"]
    await db.commit()
    return created


async def main():
    async with SessionLocal() as db:
        n = await upsert_risk_categories(db)
        print(f"risk_categories seed: {n} created, rest already existed")


if __name__ == "__main__":
    asyncio.run(main())
