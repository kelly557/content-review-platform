"""Seed platform-built-in tag catalog (metadata-only).

Idempotent: re-running only inserts missing rows (matched by code).

    PYTHONPATH=. python3 scripts/seed_tags.py
"""
from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.tag import (
    Tag,
    TagCategory,
    TagDomain,
    TagStatus,
)


PLATFORM_TAGS: list[dict[str, Any]] = [
    {
        "code": "PLT-POL-FIG-CN-LEADER",
        "name": "中国领导人",
        "name_en": "China leaders",
        "description": "现任及历任中国国家领导人及其家属、昵称、谐音、变体。",
        "domain": TagDomain.POLITICS,
        "category": TagCategory.FIGURE,
        "jurisdictions": ["cn"],
    },
    {
        "code": "PLT-POL-EVT-COLOR-REVOLUTION",
        "name": "颜色革命",
        "name_en": "Color revolution",
        "description": "颜色革命相关事件、口号、组织。",
        "domain": TagDomain.POLITICS,
        "category": TagCategory.EVENT,
        "jurisdictions": ["cn"],
    },
    {
        "code": "PLT-POL-ORG-CULT",
        "name": "邪教组织",
        "name_en": "Cult organization",
        "description": "邪教组织名称及其变体。",
        "domain": TagDomain.POLITICS,
        "category": TagCategory.ORGANIZATION,
        "jurisdictions": ["cn"],
    },
    {
        "code": "PLT-ADS-ABS-TERM",
        "name": "广告法绝对化用语",
        "name_en": "Ads law absolute terms",
        "description": "《广告法》明确禁止的绝对化用语。",
        "domain": TagDomain.ADS_LAW,
        "category": TagCategory.ABSOLUTE_TERM,
        "jurisdictions": ["cn"],
        "industries": ["general"],
    },
    {
        "code": "PLT-ADS-MEDICAL-CLAIM",
        "name": "医药功效宣称",
        "name_en": "Medical efficacy claim",
        "description": "医药/保健品违规功效宣称。",
        "domain": TagDomain.ADS_LAW,
        "category": TagCategory.CLAIM,
        "jurisdictions": ["cn"],
        "industries": ["medical", "health_food", "pharma"],
    },
    {
        "code": "PLT-FIN-GUARANTEE",
        "name": "金融收益承诺",
        "name_en": "Financial return guarantee",
        "description": "金融产品的保本/保收益承诺。",
        "domain": TagDomain.FINANCE,
        "category": TagCategory.CLAIM,
        "jurisdictions": ["cn"],
        "industries": ["finance"],
    },
    {
        "code": "PLT-MINOR-CONTENT",
        "name": "未成年人不当内容",
        "name_en": "Minor inappropriate content",
        "description": "未成年人相关不当诱导、暴露、危害。",
        "domain": TagDomain.MINOR,
        "category": TagCategory.SCENE,
        "jurisdictions": ["cn"],
    },
]


async def _upsert_tag(db: AsyncSession, spec: dict[str, Any]) -> Tag:
    code = spec["code"]
    existing = (await db.execute(select(Tag).where(Tag.code == code))).scalars().first()
    if existing:
        return existing

    tag = Tag(
        code=code,
        name=spec["name"],
        name_en=spec.get("name_en"),
        description=spec.get("description"),
        domain=spec["domain"],
        category=spec["category"],
        jurisdictions=spec.get("jurisdictions", []),
        industries=spec.get("industries", []),
        channels=spec.get("channels", []),
        knowledge_refs=spec.get("knowledge_refs", []),
        evidence_refs=spec.get("evidence_refs", []),
        status=TagStatus.ACTIVE,
        version=1,
    )
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    return tag


async def main() -> None:
    async with SessionLocal() as db:
        inserted = 0
        for spec in PLATFORM_TAGS:
            existing = (
                await db.execute(select(Tag).where(Tag.code == spec["code"]))
            ).scalars().first()
            if not existing:
                await _upsert_tag(db, spec)
                inserted += 1
        await db.commit()
        print(f"Platform tags seeded. new={inserted}, total={len(PLATFORM_TAGS)}")


if __name__ == "__main__":
    asyncio.run(main())