"""导入数美（shumei）真实业务标签体系到 tags 表。

数据源：项目根目录 shumei-labels.xlsx，Sheet1 左右两组三级级联：
  - A-C 列：图片标签树（一级/二级/三级）→ modality=image
  - E-G 列：文本标签树（一级/二级/三级）→ modality=text

合并策略（贴合前端「单树 + 三级按模态拆行」设计）：
  - 一级按名称跨模态合并（涉政/广告/色情/暴恐/违禁 5 个同名只建一次）
  - 二级按 (一级, 二级) 路径跨模态合并
  - 三级每 (完整路径, 模态) 一条记录，modality=image/text

清空重导：--apply 时会**硬删** tags 表现有全部记录（含软删），
因 code 有唯一约束，软删记录仍占 code 位。library_tags /
strategy_tag_refs 引用均为 0 时已验证安全。

用法：
  PYTHONPATH=. python3 scripts/import_shumei_labels.py --dry-run   # 只打印统计
  PYTHONPATH=. python3 scripts/import_shumei_labels.py --apply     # 实际落库
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

import openpyxl
from pypinyin import lazy_pinyin
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.tag import (
    TAG_LEVEL_LEAF,
    TAG_LEVEL_MID,
    TAG_LEVEL_TOP,
    Tag,
    TagCategory,
    TagDomain,
    TagStatus,
)

XLSX_PATH = Path(__file__).resolve().parent.parent.parent / "shumei-labels.xlsx"

# 一级标签中文名 → TagDomain 映射（未命中落 CUSTOM）
L1_DOMAIN_MAP: dict[str, TagDomain] = {
    "涉政": TagDomain.POLITICS,
    "色情": TagDomain.PORN,
    "性感": TagDomain.PORN,
    "暴恐": TagDomain.VIOLENCE,
    "广告": TagDomain.ADS_LAW,
    "广告法": TagDomain.ADS_LAW,
    "未成年人": TagDomain.MINOR,
    "隐私": TagDomain.PRIVACY,
    "网络诈骗": TagDomain.FRAUD,
    # 违禁/辱骂/攻击指令/无意义/二维码/正常/黑白名单 → CUSTOM
}


def _slug(name: str) -> str:
    """中文名 → 拼音 slug（仅字母数字下划线，code 正则要求字母开头）。"""
    py = "".join(lazy_pinyin(name))
    slug = re.sub(r"[^a-z0-9]+", "_", py.lower()).strip("_")
    return slug or "tag"


def _make_code(level: int, slug_path: list[str], modality: str | None, used: set[str]) -> str:
    """生成全局唯一 code：sm_l{level}_{路径slug}[_{mod}]，冲突加序号。"""
    base = f"sm_l{level}_{'_'.join(slug_path)}"
    if modality:
        base += f"_{modality}"
    base = base[:96]
    code, n = base, 2
    while code in used:
        suffix = f"_{n}"
        code = base[: 96 - len(suffix)] + suffix
        n += 1
    used.add(code)
    return code


def _parse_xlsx() -> list[tuple[str, str, str, str]]:
    """返回 [(modality, l1, l2, l3), ...]，跳过表头两行。"""
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True)
    ws = wb["Sheet1"]
    rows: list[tuple[str, str, str, str]] = []
    for row in ws.iter_rows(min_row=3, values_only=True):
        for base, modality in ((0, "image"), (4, "text")):
            l1, l2, l3 = row[base], row[base + 1], row[base + 2]
            if l1 and l2 and l3:
                rows.append((modality, str(l1).strip(), str(l2).strip(), str(l3).strip()))
    wb.close()
    return rows


async def run(apply: bool) -> None:
    rows = _parse_xlsx()
    if not rows:
        print("[import] xlsx 未解析到任何标签行，退出")
        sys.exit(1)

    # 合并树：l1 按名 / l2 按路径 / l3 每 (路径,模态) 一条
    l1_names = sorted({r[1] for r in rows})
    l2_paths = sorted({(r[1], r[2]) for r in rows})
    print(f"[import] 解析：一级 {len(l1_names)} / 二级 {len(l2_paths)} / 三级记录 {len(rows)}")

    used_codes: set[str] = set()
    stats = {"l1": 0, "l2": 0, "l3": 0, "skipped": 0, "deleted": 0}

    async with SessionLocal() as db:
        if apply:
            # 清空重导：硬删全部 tags（含软删），library_tags/strategy_tag_refs 已确认为 0
            deleted = await db.execute(delete(Tag))
            stats["deleted"] = deleted.rowcount or 0
            print(f"[import] 已硬删现有 tags: {stats['deleted']} 条")
        else:
            existing = (await db.execute(select(Tag.code))).scalars().all()
            used_codes.update(existing)

        l1_ids: dict[str, str] = {}
        l2_ids: dict[tuple[str, str], str] = {}

        # 一级
        for name in l1_names:
            slug = _slug(name)
            code = _make_code(TAG_LEVEL_TOP, [slug], None, used_codes)
            if apply:
                existing = await db.scalar(select(Tag).where(Tag.code == code))
                if existing:
                    l1_ids[name] = existing.id
                    stats["skipped"] += 1
                    continue
                tag = Tag(
                    code=code, name=name,
                    domain=L1_DOMAIN_MAP.get(name, TagDomain.CUSTOM),
                    category=TagCategory.CUSTOM,
                    status=TagStatus.ACTIVE,
                    level=TAG_LEVEL_TOP,
                )
                db.add(tag)
                await db.flush()
                l1_ids[name] = tag.id
            stats["l1"] += 1

        # 二级（继承父级 domain）
        for l1, l2 in l2_paths:
            slug_path = [_slug(l1), _slug(l2)]
            code = _make_code(TAG_LEVEL_MID, slug_path, None, used_codes)
            if apply:
                existing = await db.scalar(select(Tag).where(Tag.code == code))
                if existing:
                    l2_ids[(l1, l2)] = existing.id
                    stats["skipped"] += 1
                    continue
                tag = Tag(
                    code=code, name=l2,
                    domain=L1_DOMAIN_MAP.get(l1, TagDomain.CUSTOM),
                    category=TagCategory.CUSTOM,
                    status=TagStatus.ACTIVE,
                    level=TAG_LEVEL_MID,
                    parent_id=l1_ids[l1],
                )
                db.add(tag)
                await db.flush()
                l2_ids[(l1, l2)] = tag.id
            stats["l2"] += 1

        # 三级（每路径×模态一条；继承一级 domain）
        for modality, l1, l2, l3 in rows:
            slug_path = [_slug(l1), _slug(l2), _slug(l3)]
            code = _make_code(TAG_LEVEL_LEAF, slug_path, modality, used_codes)
            if apply:
                existing = await db.scalar(select(Tag).where(Tag.code == code))
                if existing:
                    stats["skipped"] += 1
                    continue
                parent_id = l2_ids[(l1, l2)]
                tag = Tag(
                    code=code, name=l3,
                    domain=L1_DOMAIN_MAP.get(l1, TagDomain.CUSTOM),
                    category=TagCategory.CUSTOM,
                    status=TagStatus.ACTIVE,
                    level=TAG_LEVEL_LEAF,
                    parent_id=parent_id,
                    modality=modality,
                )
                db.add(tag)
            stats["l3"] += 1
            if apply and stats["l3"] % 500 == 0:
                await db.flush()

        if apply:
            await db.commit()

    mode = "APPLY" if apply else "DRY-RUN"
    print(
        f"[import][{mode}] 一级 {stats['l1']} / 二级 {stats['l2']} / 三级 {stats['l3']}"
        f" / 跳过(已存在) {stats['skipped']} / 硬删 {stats['deleted']}"
    )
    if not apply:
        print("[import] dry-run 未落库；确认无误后加 --apply")


def main() -> None:
    parser = argparse.ArgumentParser(description="导入数美业务标签到 tags 表")
    parser.add_argument("--dry-run", action="store_true", help="只打印统计，不落库（默认行为）")
    parser.add_argument("--apply", action="store_true", help="实际写入数据库（会先硬删现有 tags）")
    args = parser.parse_args()
    if args.apply:
        asyncio.run(run(apply=True))
    else:
        asyncio.run(run(apply=False))


if __name__ == "__main__":
    main()
