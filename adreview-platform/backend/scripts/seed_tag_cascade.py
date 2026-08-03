"""Seed level-2 (mid) tags under existing level-1 tags.

为已有的一级风险标签补二级子标签,让 LibraryTagPicker 的级联效果可见。

为什么是独立脚本:
- 项目 CLAUDE.md 禁止无脑跑 ``scripts/seed.py`` (会覆盖 is_platform 等手工字段)
- 也不允许 ``init_db.py`` (DROP SCHEMA)
- 本脚本**只插入新行**,不修改/删除任何已有 tag,失败可重跑 (按 code 去重)。

用法:
    python scripts/seed_tag_cascade.py            # 默认 --dry-run
    python scripts/seed_tag_cascade.py --dry-run # 仅打印将插入内容
    python scripts/seed_tag_cascade.py --apply   # 实际落库
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401  -- 注册 Tag 等 model

from app.db.session import async_sessionmaker, create_async_engine
from app.models.tag import (
    TAG_LEVEL_MID,
    TAG_LEVEL_TOP,
    Tag,
    TagCategory,
    TagDomain,
    TagStatus,
)


@dataclass
class MidTagSpec:
    """二级标签 spec,parent_code 引用一级 tag.code (须已存在)。"""

    parent_code: str
    code: str
    name: str
    domain: TagDomain
    category: TagCategory


# 在已有的一级标签下各加 1-2 个二级 (按用户推荐范围: 7 个一级 / 14 个二级)。
DEFAULT_MID_TAGS: list[MidTagSpec] = [
    # 政治人物
    MidTagSpec("tag_politics_figure", "tag_politics_figure_leader", "领导人", TagDomain.POLITICS, TagCategory.FIGURE),
    MidTagSpec("tag_politics_figure", "tag_politics_figure_sensitive", "敏感人物", TagDomain.POLITICS, TagCategory.FIGURE),
    # 政治事件
    MidTagSpec("tag_politics_event", "tag_politics_event_major", "重大事件", TagDomain.POLITICS, TagCategory.EVENT),
    MidTagSpec("tag_politics_event", "tag_politics_event_group", "群体事件", TagDomain.POLITICS, TagCategory.EVENT),
    # 色情图像
    MidTagSpec("tag_porn_image", "tag_porn_image_explicit", "露骨内容", TagDomain.PORN, TagCategory.SCENE),
    MidTagSpec("tag_porn_image", "tag_porn_image_imply", "暗示内容", TagDomain.PORN, TagCategory.SCENE),
    # 暴力场景
    MidTagSpec("tag_violence_scene", "tag_violence_scene_bloody", "血腥", TagDomain.VIOLENCE, TagCategory.SCENE),
    MidTagSpec("tag_violence_scene", "tag_violence_scene_weapon", "凶器", TagDomain.VIOLENCE, TagCategory.SCENE),
    # 医疗宣称
    MidTagSpec("tag_medical_claim", "tag_medical_claim_efficacy", "疗效承诺", TagDomain.MEDICAL, TagCategory.CLAIM),
    MidTagSpec("tag_medical_claim", "tag_medical_claim_cure_rate", "治愈率", TagDomain.MEDICAL, TagCategory.CLAIM),
    # 绝对化用语
    MidTagSpec("tag_ads_absolute", "tag_ads_absolute_top", "最高级", TagDomain.ADS_LAW, TagCategory.ABSOLUTE_TERM),
    MidTagSpec("tag_ads_absolute", "tag_ads_absolute_only", "唯一性", TagDomain.ADS_LAW, TagCategory.ABSOLUTE_TERM),
    # 缺失资质
    MidTagSpec("tag_ads_credential", "tag_ads_credential_trademark", "商标缺失", TagDomain.ADS_LAW, TagCategory.CREDENTIAL),
    MidTagSpec("tag_ads_credential", "tag_ads_credential_license", "许可证缺失", TagDomain.ADS_LAW, TagCategory.CREDENTIAL),
]


async def _load_existing_codes(db: AsyncSession) -> set[str]:
    """返回已存在的 tag.code 集合 (含 soft-deleted,以便去重)。"""
    rows = (await db.execute(select(Tag.code))).all()
    return {r[0] for r in rows}


async def _load_top_codes_to_ids(db: AsyncSession) -> dict[str, str]:
    """返回 {tag.code: tag.id} 仅 level=1 且未软删除的。"""
    rows = (
        await db.execute(
            select(Tag.id, Tag.code).where(
                Tag.level == TAG_LEVEL_TOP,
                Tag.deleted_at.is_(None),
            )
        )
    ).all()
    return {code: tag_id for tag_id, code in rows}


async def _resolve_missing_parents(
    db: AsyncSession, specs: list[MidTagSpec]
) -> list[str]:
    """校验 spec 里的 parent_code 都能找到;返回缺失的 code 列表 (告警用)。"""
    top_codes = await _load_top_codes_to_ids(db)
    return [s.parent_code for s in specs if s.parent_code not in top_codes]


async def _seed(db: AsyncSession, *, apply: bool) -> tuple[int, int, list[str]]:
    """执行 dry-run / apply;返回 (would_insert, skipped_existing, warnings)。"""
    existing = await _load_existing_codes(db)
    missing_parents = await _resolve_missing_parents(db, DEFAULT_MID_TAGS)

    warnings: list[str] = []
    if missing_parents:
        warnings.append(
            f"以下 parent_code 在 level=1 中找不到 (将跳过): {', '.join(missing_parents)}"
        )

    would_insert: list[MidTagSpec] = []
    skipped: list[MidTagSpec] = []
    for s in DEFAULT_MID_TAGS:
        if s.parent_code in {m for m in missing_parents}:
            continue
        if s.code in existing:
            skipped.append(s)
        else:
            would_insert.append(s)

    if not apply:
        return len(would_insert), len(skipped), warnings

    if not would_insert:
        return 0, len(skipped), warnings

    top_codes_to_ids = await _load_top_codes_to_ids(db)
    for s in would_insert:
        parent_id = top_codes_to_ids[s.parent_code]
        db.add(
            Tag(
                id=str(uuid.uuid4()),
                code=s.code,
                name=s.name,
                domain=s.domain,
                category=s.category,
                level=TAG_LEVEL_MID,
                parent_id=parent_id,
                status=TagStatus.ACTIVE,
                jurisdictions=[],
                industries=[],
                channels=[],
                knowledge_refs=[],
                evidence_refs=[],
            )
        )
    await db.commit()
    return len(would_insert), len(skipped), warnings


async def _amain() -> int:
    parser = argparse.ArgumentParser(description="Seed level-2 tag cascade")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际落库 (默认 dry-run, 仅打印将插入内容)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印将插入内容 (默认)",
    )
    args = parser.parse_args()
    apply: bool = args.apply

    engine = create_async_engine(
        # 复用项目默认 DSN (与 seed.py 行为一致)
        "postgresql+asyncpg://adreview:adreview@localhost:5432/adreview",
    )
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with maker() as db:
        n_insert, n_skip, warnings = await _seed(db, apply=apply)
    await engine.dispose()

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] will insert: {n_insert}    skipped (already exists): {n_skip}")
    if apply and n_insert:
        print(f"已写入 {n_insert} 个 level-2 tag")
    elif not apply and n_insert:
        print("(dry-run 不会写入数据库;加 --apply 真正落库)")
    if warnings:
        for w in warnings:
            print(f"WARN: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_amain()))
