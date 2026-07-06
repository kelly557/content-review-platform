"""One-shot data migration: backfill audit_items + audit_points from detection_rules.

Idempotent. Re-running produces no duplicates.

Usage:
    PYTHONPATH=. python3 scripts/data_migrate_rule_hierarchy.py [--dry-run]

Walks every detection_rule row, maps its label to an audit_item using the
embedded LABEL_TO_ITEM table, creates the item if missing, then creates a
matching audit_point. Sets detection_rules.audit_point_id as a bridge.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint, AuditPointRisk
from app.models.detection_rule import DetectionRule


LABEL_TO_ITEM: dict[str, dict] = {
    "ad_compliance_detection_pro": {
        "pt_logotoSocialNetwork":  ("pt_water_mark", "水印",   ["水印", "logo", "watermark"]),
        "pt_qrCode":                ("pt_qr_code",   "二维码", ["二维码", "qrcode", "QR码", "小程序码"]),
        "pt_programCode":           ("pt_qr_code",   "二维码", ["二维码", "qrcode", "QR码", "小程序码"]),
        "pt_toDirectContact_tii":   ("pt_drainage",  "引流",   ["引流", "联系方式", "兼职招聘", "办证", "投资理财"]),
        "pt_toSocialNetwork_tii":   ("pt_drainage",  "引流",   ["引流", "联系方式", "兼职招聘", "办证", "投资理财"]),
        "pt_toShortVideos_tii":     ("pt_drainage",  "引流",   ["引流", "联系方式", "兼职招聘", "办证", "投资理财"]),
        "pt_investment_tii":        ("pt_drainage",  "引流",   ["引流", "联系方式", "兼职招聘", "办证", "投资理财"]),
        "pt_recruitment_tii":       ("pt_drainage",  "引流",   ["引流", "联系方式", "兼职招聘", "办证", "投资理财"]),
        "pt_certificate_tii":       ("pt_drainage",  "引流",   ["引流", "联系方式", "兼职招聘", "办证", "投资理财"]),
    },
    "text_audit_pro": {
        "tx_politics":            ("tx_politics",         "涉政",       ["涉政", "政治敏感", "politics"]),
        "tx_terrorism":           ("tx_terrorism",        "暴恐",       ["暴恐", "恐怖", "terrorism", "violence"]),
        "tx_porn":                ("tx_porn",             "色情",       ["色情", "低俗", "porn"]),
        "tx_advertising":         ("tx_advertising",      "广告法",     ["广告法", "极限用语", "advertising"]),
        "tx_abuse":               ("tx_abuse",            "辱骂",       ["辱骂", "谩骂", "abuse"]),
        "tx_vulgar":              ("tx_vulgar",           "低俗",       ["低俗", "vulgar"]),
        "tx_minor_protection":    ("tx_minor_protection", "未成年保护", ["未成年", "minor"]),
        "tx_values":              ("tx_values",           "价值观",     ["价值观", "values"]),
        "tx_illegal":             ("tx_illegal",          "违法违规",   ["违法", "illegal"]),
    },
}


def _risk_from_thresholds(medium: float, high: float) -> AuditPointRisk:
    if high >= 85:
        return AuditPointRisk.HIGH
    if medium <= 55:
        return AuditPointRisk.LOW
    return AuditPointRisk.MEDIUM


async def _get_or_create_item(
    db: AsyncSession,
    package_code: str,
    item_code: str,
    name_cn: str,
    aliases: list[str],
) -> AuditItem:
    result = await db.execute(
        select(AuditItem).where(
            AuditItem.package_code == package_code,
            AuditItem.code == item_code,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing
    item = AuditItem(
        package_code=package_code,
        code=item_code,
        name_cn=name_cn,
        aliases=aliases,
        sort_order=0,
        is_enabled=True,
    )
    db.add(item)
    await db.flush()
    return item


async def _create_point_for_rule(
    db: AsyncSession,
    rule: DetectionRule,
    item: AuditItem,
) -> Optional[AuditPoint]:
    result = await db.execute(
        select(AuditPoint).where(
            AuditPoint.package_code == rule.service_code,
            AuditPoint.code == rule.label,
        )
    )
    if result.scalar_one_or_none():
        return None
    point = AuditPoint(
        package_code=rule.service_code,
        item_id=item.id,
        code=rule.label,
        label=rule.label,
        label_cn=rule.label_cn,
        description=rule.description,
        medium_threshold=rule.medium_threshold,
        high_threshold=rule.high_threshold,
        scope_text=rule.scope_text,
        risk_level=_risk_from_thresholds(rule.medium_threshold, rule.high_threshold),
        is_enabled=rule.is_enabled,
        custom_wordset_id=rule.custom_wordset_id,
        sort_order=0,
    )
    db.add(point)
    await db.flush()
    return point


async def migrate(db: AsyncSession, dry_run: bool) -> tuple[int, int, int]:
    rules_result = await db.execute(select(DetectionRule))
    rules = list(rules_result.scalars())

    items_created = 0
    points_created = 0
    bridges_updated = 0

    pending_items: dict[tuple[str, str], tuple[str, str, list[str]]] = {}
    pending_points: list[tuple[DetectionRule, AuditItem]] = []

    for rule in rules:
        mapping = LABEL_TO_ITEM.get(rule.service_code, {}).get(rule.label)
        if not mapping:
            continue
        item_code, item_name, aliases = mapping
        item = await _get_or_create_item(
            db, rule.service_code, item_code, item_name, aliases
        )
        if item.id is None:
            items_created += 1
        point = await _create_point_for_rule(db, rule, item)
        if point:
            pending_points.append((rule, point))
            points_created += 1
        rule.audit_point_id = point.id if point else rule.audit_point_id
        bridges_updated += 1

    if dry_run:
        await db.rollback()
    else:
        await db.commit()

    return items_created, points_created, bridges_updated


async def main_async(dry_run: bool) -> None:
    async with SessionLocal() as db:
        try:
            ic, pc, bu = await migrate(db, dry_run=dry_run)
            extra_ic = await seed_extra_items(db, dry_run=dry_run)
            extra_pc = await seed_extra_points(db, dry_run=dry_run)
            if dry_run:
                await db.rollback()
            else:
                await db.commit()
            mode = "DRY-RUN" if dry_run else "APPLIED"
            print(
                f"[{mode}] audit_items created={ic} audit_points created={pc} "
                f"rules_bridged={bu} extra_items_created={extra_ic} "
                f"extra_points_created={extra_pc}"
            )
        except Exception as exc:
            await db.rollback()
            print(f"ERROR: {exc}", file=sys.stderr)
            raise


EXTRA_ITEMS: dict[str, dict[str, tuple[str, str, list[str]]]] = {
    "image_audit_pro": {
        "img_politics":   ("涉政",   ["涉政", "政治敏感", "politics"]),
        "img_porn":       ("涉黄",   ["涉黄", "色情", "porn"]),
        "img_violence":   ("涉暴",   ["涉暴", "暴力", "violence"]),
        "img_prohibited": ("违禁",   ["违禁", "prohibited"]),
        "img_terrorism":  ("暴恐",   ["暴恐", "恐怖", "terrorism"]),
        "img_ad":         ("广告",   ["广告", "advertisement"]),
        "img_adlaw":      ("广告法", ["广告法", "极限用语", "adlaw"]),
        "img_religion":   ("宗教",   ["宗教", "religion"]),
        "img_special":    ("专项",   ["专项", "special"]),
    },
    "text_audit_pro": {
        "tx_privacy":      ("隐私信息",  ["隐私", "个人信息", "privacy"]),
        "tx_promptattack": ("prompt攻击", ["prompt攻击", "prompt", "jailbreak"]),
    },
}


# Each tuple: (item_code, point_code, label_cn, scope_text, medium, high, risk_level)
EXTRA_POINTS: dict[str, list[tuple[str, str, str, str, float, float, str]]] = {
    "image_audit_pro": [
        ("img_politics",   "img_politics_general",   "涉政通用",   "含政治敏感人物、事件或标志",       60.0, 85.0, "高风险"),
        ("img_porn",       "img_porn_general",       "涉黄通用",   "含裸露、色情或低俗内容",           55.0, 85.0, "高风险"),
        ("img_violence",   "img_violence_general",   "涉暴通用",   "含血腥、暴力或恐怖画面",           60.0, 90.0, "高风险"),
        ("img_prohibited", "img_prohibited_general", "违禁通用",   "含违禁品、管制器具或标识",         55.0, 80.0, "高风险"),
        ("img_terrorism",  "img_terrorism_general",  "暴恐通用",   "含极端组织符号、爆炸物或恐袭内容", 60.0, 85.0, "高风险"),
        ("img_ad",         "img_ad_general",         "广告通用",   "画面中含第三方广告或品牌标识",     50.0, 75.0, "中风险"),
        ("img_adlaw",      "img_adlaw_general",      "广告法通用", "含极限用语、虚假承诺或违规宣传",   55.0, 80.0, "高风险"),
        ("img_religion",   "img_religion_general",   "宗教通用",   "含宗教符号、极端宗教内容",         50.0, 75.0, "中风险"),
        ("img_special",    "img_special_general",    "专项通用",   "专项检查任务标识的内容",           50.0, 75.0, "中风险"),
    ],
    "text_audit_pro": [
        ("tx_privacy",      "tx_privacy_pii",         "PII 检测",       "识别身份证、手机号、银行卡等隐私", 60.0, 85.0, "高风险"),
        ("tx_privacy",      "tx_privacy_contact",     "联系方式检测",   "识别地址、邮箱、微信号等联系方式", 55.0, 80.0, "中风险"),
        ("tx_promptattack", "tx_promptattack_basic",  "基础越狱指令",   "识别基础 prompt 越狱指令",         70.0, 90.0, "高风险"),
        ("tx_promptattack", "tx_promptattack_adv",    "高级越狱指令",   "识别编码、嵌套等高级越狱指令",     65.0, 85.0, "高风险"),
    ],
}


async def seed_extra_items(db: AsyncSession, dry_run: bool) -> int:
    """Seed the EXTRA_ITEMS audit items for the rule packages.

    Creates audit_items rows only (no audit_points). Idempotent.
    """
    created = 0
    for package_code, items in EXTRA_ITEMS.items():
        for code, (name_cn, aliases) in items.items():
            result = await db.execute(
                select(AuditItem).where(
                    AuditItem.package_code == package_code,
                    AuditItem.code == code,
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                continue
            db.add(
                AuditItem(
                    package_code=package_code,
                    code=code,
                    name_cn=name_cn,
                    aliases=aliases,
                    sort_order=0,
                    is_enabled=True,
                )
            )
            created += 1
    if not dry_run:
        await db.flush()
    return created


async def seed_extra_points(db: AsyncSession, dry_run: bool) -> int:
    """Seed EXTRA_POINTS under their parent audit_items.

    Idempotent: skips when (package_code, code) already exists.
    """
    created = 0
    for package_code, points in EXTRA_POINTS.items():
        for (
            item_code,
            point_code,
            label_cn,
            scope_text,
            medium,
            high,
            risk,
        ) in points:
            item_result = await db.execute(
                select(AuditItem).where(
                    AuditItem.package_code == package_code,
                    AuditItem.code == item_code,
                )
            )
            item = item_result.scalar_one_or_none()
            if not item:
                continue
            existing = await db.execute(
                select(AuditPoint).where(
                    AuditPoint.package_code == package_code,
                    AuditPoint.code == point_code,
                )
            )
            if existing.scalar_one_or_none():
                continue
            db.add(
                AuditPoint(
                    package_code=package_code,
                    item_id=item.id,
                    code=point_code,
                    label=point_code,
                    label_cn=label_cn,
                    description=scope_text,
                    scope_text=scope_text,
                    medium_threshold=medium,
                    high_threshold=high,
                    risk_level=AuditPointRisk(risk),
                    is_enabled=True,
                    sort_order=0,
                )
            )
            created += 1
    if not dry_run:
        await db.flush()
    return created


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main_async(dry_run=args.dry_run))


if __name__ == "__main__":
    main()