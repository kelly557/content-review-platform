"""Seed initial data: roles represented via users + default workflow templates + default strategy + service catalog."""
import argparse
import asyncio
import fcntl
import os
import sys
from typing import Any, List, Optional, Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal, engine
from app.models.service import Service, ServiceScope
from app.models.service_category import ServiceCategory
from app.models.wordset import WordSet, WordSetKind
from app.models.strategy import Strategy, StrategyScope
from app.models.user import User, UserRole
from app.models.workflow import WorkflowTemplate
from app.models.trigger import Trigger
from app.models.detection_rule import DetectionRule
from app.models.human_review_config import HumanReviewConfig
from app.models.tag import Tag, TagCategory, TagDomain, TagStatus
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint, AuditPointRisk
from app.models.library import Library, LibraryType, LibraryKind


DEFAULT_TEMPLATES = [
    {
        "code": "simple",
        "name": "两级审核",
        "description": "初审 → 终审",
        "definition": {
            "stages": [
                {"key": "initial", "name": "初审", "type": "human", "role": "reviewer", "mode": "single"},
                {"key": "final", "name": "终审", "type": "human", "role": "reviewer", "mode": "single"},
            ]
        },
    },
    {
        "code": "mlr",
        "name": "MLR 三级审核",
        "description": "初审 → MLR 联合审核 → 终审",
        "definition": {
            "stages": [
                {"key": "initial", "name": "初审", "type": "human", "role": "reviewer", "mode": "single"},
                {"key": "mlr", "name": "MLR 联合审核", "type": "human", "role": "mlr", "mode": "joint"},
                {"key": "final", "name": "终审", "type": "human", "role": "reviewer", "mode": "single"},
            ]
        },
    },
    {
        "code": "auto_only",
        "name": "全自动机审",
        "description": "仅 AI 智能扫描，无人工审核",
        "definition": {
            "stages": [
                {
                    "key": "ai_scan",
                    "name": "AI 智能扫描",
                    "type": "machine",
                    "role": "system",
                    "mode": "single",
                    "config": {
                        "services": ["text_detection_pro"],
                        "timeout_seconds": 30,
                    },
                },
            ]
        },
    },
    {
        "code": "hybrid",
        "name": "机审 + 人审",
        "description": "AI 智能扫描 → 根据风险等级决定是否人工审核",
        "definition": {
            "stages": [
                {
                    "key": "ai_scan",
                    "name": "AI 智能扫描",
                    "type": "machine",
                    "role": "system",
                    "mode": "single",
                    "config": {
                        "services": ["text_detection_pro"],
                        "timeout_seconds": 30,
                    },
                },
                {
                    "key": "initial",
                    "name": "初审",
                    "type": "human",
                    "role": "reviewer",
                    "mode": "single",
                    "config": {"auto_assign": True},
                },
                {
                    "key": "final",
                    "name": "终审",
                    "type": "human",
                    "role": "reviewer",
                    "mode": "single",
                    "config": {"auto_assign": True},
                },
            ]
        },
    },
]


async def _upsert_templates(db: AsyncSession) -> None:
    for tpl in DEFAULT_TEMPLATES:
        result = await db.execute(select(WorkflowTemplate).where(WorkflowTemplate.code == tpl["code"]))
        existing = result.scalar_one_or_none()
        if existing:
            existing.name = tpl["name"]
            existing.description = tpl["description"]
            existing.definition = tpl["definition"]
            existing.is_active = True
        else:
            db.add(WorkflowTemplate(is_active=True, **tpl))


async def _upsert_user(db: AsyncSession, email: str, name: str, role: UserRole, password: str) -> None:
    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        return
    db.add(
        User(
            email=email,
            full_name=name,
            hashed_password=hash_password(password),
            role=role,
        )
    )


async def _upsert_default_strategy(db: AsyncSession) -> None:
    """Ensure exactly one DEFAULT strategy exists (singleton)."""
    result = await db.execute(select(Strategy).where(Strategy.scope == StrategyScope.DEFAULT))
    if result.scalar_one_or_none():
        return
    db.add(
        Strategy(
            code="1",
            name="默认策略",
            scope=StrategyScope.DEFAULT,
            description="当未配置其他策略、或所有策略均未启用/均未达生效时间时生效。",
            is_active=True,
            effective_from=None,
            effective_until=None,
            definition={},
        )
    )


DEFAULT_CATEGORIES: list[dict] = [
    {"code": "business", "name": "业务场景", "description": "常规业务场景下的检测服务", "is_system": True, "sort_order": 1},
    {"code": "special", "name": "特殊场景", "description": "特殊业务场景下的检测服务", "is_system": True, "sort_order": 2},
    {"code": "aigc", "name": "AIGC场景", "description": "AIGC 相关检测服务", "is_system": True, "sort_order": 3},
    {"code": "bailian", "name": "百炼场景", "description": "百炼平台相关检测服务", "is_system": True, "sort_order": 4},
    {"code": "general", "name": "通用场景", "description": "通用内容安全检测服务", "is_system": True, "sort_order": 5},
]

CATEGORY_CODE_TO_SCOPE = {
    "business": ServiceScope.BUSINESS,
    "special": ServiceScope.SPECIAL,
    "aigc": ServiceScope.AIGC,
    "bailian": ServiceScope.BAILIAN,
    "general": ServiceScope.GENERAL,
}


async def _upsert_categories(db: AsyncSession) -> None:
    for c in DEFAULT_CATEGORIES:
        result = await db.execute(select(ServiceCategory).where(ServiceCategory.code == c["code"]))
        existing = result.scalar_one_or_none()
        if existing:
            existing.name = c["name"]
            existing.description = c["description"]
            existing.sort_order = c["sort_order"]
        else:
            db.add(ServiceCategory(**c))


DEFAULT_SERVICES: list[dict] = [
    {"code": "ad_compliance_detection_pro", "name": "广告法合规检测_专业版", "scope": ServiceScope.SPECIAL, "is_active": True, "category_code": "special"},
    {"code": "text_audit_pro", "name": "文本审核_专业版", "scope": ServiceScope.BUSINESS, "is_active": True, "category_code": "business"},
    {"code": "general_content_audit", "name": "通用内容审核", "scope": ServiceScope.GENERAL, "is_active": True, "category_code": "general"},
    {"code": "image_audit_pro", "name": "图片通用审核_专业版", "scope": ServiceScope.GENERAL, "is_active": True, "category_code": "general"},
    {"code": "audio_audit_pro", "name": "语音审核_专业版", "scope": ServiceScope.GENERAL, "is_active": True, "category_code": "general"},
    {"code": "document_audit_pro", "name": "文档审核_专业版", "scope": ServiceScope.GENERAL, "is_active": True, "category_code": "general"},
    {"code": "video_audit_pro", "name": "视频审核_专业版", "scope": ServiceScope.GENERAL, "is_active": True, "category_code": "general"},
]


async def _purge_removed_services(
    db: AsyncSession, *, apply: bool = False, dry_run: bool = False
) -> None:
    """Delete services whose code is no longer in DEFAULT_SERVICES.

    Cascades FK cleanup on detection_rules / human_review_configs /
    audit_points / audit_items and prunes stale service codes from
    strategies.definition.services[].

    默认 apply=False + dry_run=False：
      - apply=False 时整个函数 no-op，避免误删用户态数据
      - dry_run=True 仅打印将删除的内容（配合 apply=False 使用）
    真的要删除：seed.py 入口需 --purge-removed --apply 双开关
    """
    if not apply:
        return
    allowed_codes = {s["code"] for s in DEFAULT_SERVICES}
    result = await db.execute(select(Service.code))
    existing_codes = {row[0] for row in result.all()}
    stale_codes = existing_codes - allowed_codes
    if not stale_codes:
        return
    if dry_run:
        print(f"[purge-removed][dry-run] will delete {len(stale_codes)} services: {sorted(stale_codes)}")
        return
    await db.execute(
        delete(DetectionRule).where(DetectionRule.service_code.in_(stale_codes))
    )
    await db.execute(
        delete(HumanReviewConfig).where(
            HumanReviewConfig.service_code.in_(stale_codes)
        )
    )
    await db.execute(
        delete(AuditPoint).where(AuditPoint.package_code.in_(stale_codes))
    )
    await db.execute(
        delete(AuditItem).where(AuditItem.package_code.in_(stale_codes))
    )
    strategies = await db.execute(select(Strategy))
    for strat in strategies.scalars():
        definition = strat.definition or {}
        services = list(definition.get("services") or [])
        cleaned = [c for c in services if c not in stale_codes]
        if cleaned != services:
            strat.definition = {**definition, "services": cleaned}
    await db.execute(delete(Service).where(Service.code.in_(stale_codes)))
    print(f"purged stale services: {sorted(stale_codes)}")


async def _upsert_services(db: AsyncSession) -> None:
    cat_result = await db.execute(select(ServiceCategory))
    cat_by_code = {c.code: c for c in cat_result.scalars()}

    for s in DEFAULT_SERVICES:
        category_code = s.pop("category_code", None)
        category_id = cat_by_code[category_code].id if category_code and category_code in cat_by_code else None
        result = await db.execute(select(Service).where(Service.code == s["code"]))
        existing = result.scalar_one_or_none()
        if existing:
            existing.name = s["name"]
            existing.scope = s["scope"]
            existing.is_active = s["is_active"]
            if category_id is not None:
                existing.category_id = category_id
        else:
            db.add(Service(**s, category_id=category_id))


DEFAULT_WORDSETS: list[dict] = [
    {
        "code": "ws_default_blacklist",
        "name": "默认黑名单",
        "kind": WordSetKind.BLACKLIST,
        "description": "全局默认禁止词集合",
        "words": ["敏感词示例A", "敏感词示例B"],
        "ignored_services": ["ad_compliance_detection_pro"],
    },
    {
        "code": "ws_default_whitelist",
        "name": "默认白名单",
        "kind": WordSetKind.WHITELIST,
        "description": "全局默认放行词集合",
        "words": ["合规用语示例"],
        "ignored_services": [],
    },
    {
        "code": "ws_pharma_marketing",
        "name": "医药营销",
        "kind": WordSetKind.WHITELIST,
        "description": "医药行业营销合规放行词",
        "words": [],
        "ignored_services": ["ad_compliance_detection_pro"],
    },
    {
        "code": "ws_company_redline",
        "name": "公司红线",
        "kind": WordSetKind.BLACKLIST,
        "description": "公司级违规红线词",
        "words": [],
        "ignored_services": ["ad_compliance_detection_pro"],
    },
    {
        "code": "ws_text_legal_terms",
        "name": "文本法律术语",
        "kind": WordSetKind.WHITELIST,
        "description": "文本审核专用合法术语放行词",
        "words": ["依据相关法规", "本产品", "本公司"],
        "ignored_services": ["text_audit_pro"],
    },
]


async def _upsert_wordsets(db: AsyncSession) -> None:
    for w in DEFAULT_WORDSETS:
        result = await db.execute(select(WordSet).where(WordSet.code == w["code"]))
        existing = result.scalar_one_or_none()
        words = w.pop("words", [])
        ignored = w.pop("ignored_services", [])
        if existing:
            existing.name = w["name"]
            existing.kind = w["kind"]
            existing.description = w["description"]
            if existing.words_text is None and words:
                existing.words_text = "\n".join(words)
            # ignored_services 只在尚未被新逻辑设置时初始化为种子默认值
            if existing.ignored_services is None:
                existing.ignored_services = ignored
        else:
            db.add(
                WordSet(
                    **w,
                    words_text="\n".join(words) if words else None,
                    ignored_services=ignored,
                )
            )


# 各服务细分场景 (service_code, rule_dict)
# medium_threshold < high_threshold 由 backend 检测规则 schema 校验
DEFAULT_DETECTION_RULES: list[tuple[str, dict]] = [
    ("ad_compliance_detection_pro", {"label": "pt_logotoSocialNetwork", "label_cn": "常见网络社交平台水印", "description": "画面中疑似含有常见网络社交平台水印", "medium_threshold": 50.0, "high_threshold": 80.0, "scope_text": "常见网络社交平台水印", "is_enabled": True}),
    ("ad_compliance_detection_pro", {"label": "pt_qrCode", "label_cn": "二维码", "description": "画面中疑似含有二维码", "medium_threshold": 50.0, "high_threshold": 80.0, "scope_text": "画面中含有二维码", "is_enabled": True}),
    ("ad_compliance_detection_pro", {"label": "pt_programCode", "label_cn": "小程序码", "description": "画面中疑似含有小程序码", "medium_threshold": 50.0, "high_threshold": 80.0, "scope_text": "画面中含有小程序码", "is_enabled": False}),
    ("ad_compliance_detection_pro", {"label": "pt_toDirectContact_tii", "label_cn": "联系方式引流", "description": "图中文字含联系方式类引流信息", "medium_threshold": 60.0, "high_threshold": 90.0, "scope_text": "图中文字含网址、手机号、微信QQ等联系方式类引流信息", "is_enabled": False}),
    ("ad_compliance_detection_pro", {"label": "pt_toSocialNetwork_tii", "label_cn": "社交平台引流", "description": "图中文字含有社交平台引流信息", "medium_threshold": 60.0, "high_threshold": 90.0, "scope_text": "图中文字含有常见社交平台引流信息", "is_enabled": True}),
    ("ad_compliance_detection_pro", {"label": "pt_toShortVideos_tii", "label_cn": "短视频平台引流", "description": "图中文字含短视频平台引流信息", "medium_threshold": 60.0, "high_threshold": 90.0, "scope_text": "图中文字含常见短视频平台引流信息", "is_enabled": False}),
    ("ad_compliance_detection_pro", {"label": "pt_investment_tii", "label_cn": "投资理财引流", "description": "图中文字含投资理财类广告引流", "medium_threshold": 60.0, "high_threshold": 90.0, "scope_text": "图中文字含投资理财类广告引流", "is_enabled": False}),
    ("ad_compliance_detection_pro", {"label": "pt_recruitment_tii", "label_cn": "兼职招聘引流", "description": "图中文字含兼职招聘类广告引流", "medium_threshold": 60.0, "high_threshold": 90.0, "scope_text": "图中文字含兼职招聘类广告引流", "is_enabled": False}),
    ("ad_compliance_detection_pro", {"label": "pt_certificate_tii", "label_cn": "办证套现引流", "description": "图中文字含办证套现类广告引流", "medium_threshold": 60.0, "high_threshold": 90.0, "scope_text": "图中文字含办证套现类广告引流", "is_enabled": False}),
    ("text_audit_pro", {"label": "tx_politics", "label_cn": "涉政", "description": "文本中含涉政表述", "medium_threshold": 60.0, "high_threshold": 85.0, "scope_text": "涉政违规内容", "is_enabled": True}),
    ("text_audit_pro", {"label": "tx_terrorism", "label_cn": "暴恐", "description": "文本中含暴恐表述", "medium_threshold": 60.0, "high_threshold": 85.0, "scope_text": "暴恐违规内容", "is_enabled": True}),
    ("text_audit_pro", {"label": "tx_porn", "label_cn": "色情", "description": "文本中含色情表述", "medium_threshold": 60.0, "high_threshold": 85.0, "scope_text": "色情违规内容", "is_enabled": True}),
    ("text_audit_pro", {"label": "tx_advertising", "label_cn": "广告法违规", "description": "文本中含广告法违规表述", "medium_threshold": 55.0, "high_threshold": 80.0, "scope_text": "广告法违规内容（极限用词、承诺保证等）", "is_enabled": True}),
    ("text_audit_pro", {"label": "tx_abuse", "label_cn": "辱骂", "description": "文本中含辱骂或人身攻击", "medium_threshold": 55.0, "high_threshold": 80.0, "scope_text": "辱骂或人身攻击内容", "is_enabled": False}),
    ("text_audit_pro", {"label": "tx_vulgar", "label_cn": "低俗", "description": "文本中含低俗表述", "medium_threshold": 55.0, "high_threshold": 80.0, "scope_text": "低俗内容", "is_enabled": False}),
    ("text_audit_pro", {"label": "tx_minor_protection", "label_cn": "未成年保护", "description": "文本中含未成年保护相关违规", "medium_threshold": 55.0, "high_threshold": 80.0, "scope_text": "未成年人保护违规内容", "is_enabled": False}),
    ("text_audit_pro", {"label": "tx_values", "label_cn": "价值观", "description": "文本中含价值观违规表述", "medium_threshold": 55.0, "high_threshold": 80.0, "scope_text": "价值观违规内容", "is_enabled": False}),
    ("text_audit_pro", {"label": "tx_illegal", "label_cn": "违法违规", "description": "文本中含违法违规表述", "medium_threshold": 60.0, "high_threshold": 85.0, "scope_text": "违法违规内容", "is_enabled": False}),
]


async def _upsert_detection_rules(db: AsyncSession) -> None:
    for service_code, r in DEFAULT_DETECTION_RULES:
        result = await db.execute(
            select(DetectionRule).where(
                DetectionRule.service_code == service_code,
                DetectionRule.label == r["label"],
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.label_cn = r["label_cn"]
            existing.description = r["description"]
            existing.medium_threshold = r["medium_threshold"]
            existing.high_threshold = r["high_threshold"]
            existing.scope_text = r["scope_text"]
            existing.is_enabled = r["is_enabled"]
        else:
            db.add(DetectionRule(service_code=service_code, **r))


# ---------- AuditItem / AuditPoint seed ----------
#
# Rule hierarchy under DEFAULT_SERVICES:
#   service  = rules package (is_rule_package=True via column default)
#   item     = audit_item (mid-level grouping, e.g. 涉政 / 暴恐)
#   point    = audit_point (fine-grained detection config)
#
# Per-item points are organised in TWO groups so the rule config page
# can render two tables side by side:
#   - "main": 通用 + 图中文字 OCR (_tii)              ── 细分场景配置
#   - "lib":  图库 / 词库                              ── 自定义配置图库/词库
#
# Both groups follow the same naming convention shown in the design
# screenshot: `<item>_<sub>` (main) and `<item>_<sub>_lib` (custom).

# Each tuple: (item_code, name_cn, aliases)
DEFAULT_AUDIT_ITEMS: dict[str, dict[str, tuple[str, list[str], str | None]]] = {
    "ad_compliance_detection_pro": {
        "pt_water_mark": ("水印", ["水印", "logo", "watermark"], None),
        "pt_qr_code":    ("二维码", ["二维码", "qrcode", "QR码", "小程序码"], None),
        "pt_drainage":   ("引流", ["引流", "联系方式", "兼职招聘", "办证", "投资理财"], None),
    },
    "image_audit_pro": {
        "img_politics":   ("涉政",   ["涉政", "政治敏感", "politics"], "politics"),
        "img_porn":       ("涉黄",   ["涉黄", "色情", "porn", "低俗"], "porn"),
        "img_violence":   ("涉暴",   ["涉暴", "暴力", "血腥", "violence"], "terrorism"),
        "img_prohibited": ("违禁",   ["违禁", "毒品", "赌博", "prohibited"], "illicit"),
        "img_terrorism":  ("暴恐",   ["暴恐", "恐怖", "terrorism"], "terrorism"),
        "img_ad":         ("广告",   ["广告", "advertisement"], "ad"),
        "img_adlaw":      ("广告法", ["广告法", "极限用语", "adlaw"], "ad_law"),
        "img_religion":   ("宗教",   ["宗教", "religion"], "religion"),
        "img_special":    ("专项",   ["专项", "special"], None),
    },
    "text_audit_pro": {
        "tx_politics":         ("涉政",       ["涉政", "政治敏感", "politics"], "politics"),
        "tx_terrorism":        ("暴恐",       ["暴恐", "恐怖", "terrorism"], "terrorism"),
        "tx_porn":             ("色情",       ["色情", "低俗", "porn"], "porn"),
        "tx_advertising":      ("广告法",     ["广告法", "极限用语"], "ad_law"),
        "tx_abuse":            ("辱骂",       ["辱骂", "谩骂", "abuse"], "abuse"),
        "tx_vulgar":           ("低俗",       ["低俗", "vulgar"], "unhealthy"),
        "tx_minor_protection": ("未成年保护", ["未成年", "minor"], "unhealthy"),
        "tx_values":           ("价值观",     ["价值观", "values"], "unhealthy"),
        "tx_illegal":          ("违法违规",   ["违法", "illegal"], "illicit"),
        "tx_privacy":          ("隐私信息",   ["隐私", "个人信息", "privacy"], "unhealthy"),
        "tx_promptattack":     ("prompt攻击", ["prompt", "jailbreak"], "unhealthy"),
        # ---- 不良内容审核（聚合 1 个 item，7 个细分点作为 audit_point） ----
        "bad":                  ("不良",              ["不良内容", "未成年不适", "偏见歧视", "不良价值观", "攻击辱骂", "低俗口头语", "封建迷信", "灌水", "spam"], "unhealthy"),
    },
    "audio_audit_pro": {
        "au_politics":      ("涉政",     ["涉政", "politics"], "politics"),
        "au_porn":          ("色情",     ["色情", "porn"], "porn"),
        "au_violence":      ("暴恐",     ["暴恐", "terrorism"], "terrorism"),
        "au_adlaw":         ("广告法",   ["广告法", "adlaw"], "ad_law"),
        "au_abuse":         ("辱骂",     ["辱骂", "abuse"], "abuse"),
        "au_minor":         ("未成年保护", ["未成年", "minor"], "unhealthy"),
        "au_illegal":       ("违法违规", ["违法", "illegal"], "illicit"),
        "au_voiceprint":    ("声纹检测", ["声纹", "voiceprint"], None),
        "au_audiopquality": ("音频质量", ["音频质量", "audio_quality"], None),
    },
    "document_audit_pro": {
        "doc_image":     ("图片内容",   ["图片内容", "图片审核"], "unhealthy"),
        "doc_text":      ("文本内容",   ["文本内容", "文本审核"], "unhealthy"),
        "doc_sensitive": ("敏感信息",   ["敏感", "sensitive"], "unhealthy"),
        "doc_illegal":   ("违法违规",   ["违法", "illegal"], "illicit"),
    },
    "video_audit_pro": {
        "vid_frame":     ("画面内容",   ["画面内容", "图片审核"], "unhealthy"),
        "vid_audio":     ("音轨内容",   ["音轨内容", "语音审核"], "unhealthy"),
        "vid_subtitle":  ("字幕内容",   ["字幕内容", "文本审核"], "unhealthy"),
        "vid_illegal":   ("违法违规",   ["违法", "illegal"], "illicit"),
    },
}


# Default description for each default audit_item. Looked up by
# (package_code, item_code). Picked so the "描述" column in the
# strategy editor's step-2 规则 list has meaningful text out of the
# box instead of "—".
DEFAULT_ITEM_DESCRIPTIONS: dict[tuple[str, str], str] = {
    # ── ad_compliance_detection_pro ──
    ("ad_compliance_detection_pro", "pt_water_mark"): "识别画面中的网络社交平台、品牌方等水印信息",
    ("ad_compliance_detection_pro", "pt_qr_code"):    "识别画面中的二维码、QR 码、小程序码等",
    ("ad_compliance_detection_pro", "pt_drainage"):   "识别画面中的联系方式、兼职招聘、办证、投资理财等引流内容",
    # ── image_audit_pro ──
    ("image_audit_pro", "img_politics"):   "识别政治人物、政治事件、政治符号等涉政内容",
    ("image_audit_pro", "img_porn"):       "识别色情、低俗、裸露等涉黄内容",
    ("image_audit_pro", "img_violence"):   "识别血腥、暴力、残忍等涉暴内容",
    ("image_audit_pro", "img_prohibited"): "识别毒品、赌博、违禁品等违禁内容",
    ("image_audit_pro", "img_terrorism"):  "识别恐怖组织、恐怖袭击等暴恐内容",
    ("image_audit_pro", "img_ad"):         "识别画面中的第三方广告、品牌植入",
    ("image_audit_pro", "img_adlaw"):      "识别极限用语、虚假承诺等广告法违规内容",
    ("image_audit_pro", "img_religion"):   "识别宗教极端、宗教渗透等宗教敏感内容",
    ("image_audit_pro", "img_special"):    "专项审核场景",
    # ── text_audit_pro ──
    ("text_audit_pro", "tx_politics"):         "识别政治敏感文本",
    ("text_audit_pro", "tx_terrorism"):        "识别恐怖组织、恐怖袭击等暴恐文本",
    ("text_audit_pro", "tx_porn"):             "识别色情、低俗文本",
    ("text_audit_pro", "tx_advertising"):      "识别广告法违规表述（极限用语、虚假承诺）",
    ("text_audit_pro", "tx_abuse"):            "识别辱骂、人身攻击文本",
    ("text_audit_pro", "tx_vulgar"):           "识别低俗口头语、不文明用语",
    ("text_audit_pro", "tx_minor_protection"): "识别涉及未成年人的不良内容",
    ("text_audit_pro", "tx_values"):           "识别违反主流价值观的内容",
    ("text_audit_pro", "tx_illegal"):          "识别违法违规文本",
    ("text_audit_pro", "tx_privacy"):          "识别个人隐私信息泄露",
    ("text_audit_pro", "tx_promptattack"):     "识别 prompt 注入、越狱攻击",
    ("text_audit_pro", "bad"):                 "聚合识别不良内容（未成年不适、偏见歧视、不良价值观、攻击辱骂、低俗口头语、封建迷信、灌水）",
    # ── audio_audit_pro ──
    ("audio_audit_pro", "au_politics"):      "识别语音中的政治敏感内容",
    ("audio_audit_pro", "au_porn"):          "识别语音中的色情内容",
    ("audio_audit_pro", "au_violence"):      "识别语音中的暴恐内容",
    ("audio_audit_pro", "au_adlaw"):         "识别语音中的广告法违规词",
    ("audio_audit_pro", "au_abuse"):         "识别语音中的辱骂内容",
    ("audio_audit_pro", "au_minor"):         "识别语音中涉及未成年人的不良内容",
    ("audio_audit_pro", "au_illegal"):       "识别语音中的违法违规内容",
    ("audio_audit_pro", "au_voiceprint"):    "识别声纹特征（如娇喘等异常发声模式）",
    ("audio_audit_pro", "au_audiopquality"): "识别音频质量（如无语音内容、静音等）",
    # ── document_audit_pro ──
    ("document_audit_pro", "doc_image"):     "识别文档中的图片内容（复用图片审核规则）",
    ("document_audit_pro", "doc_text"):      "识别文档中的文本内容（复用文本审核规则）",
    ("document_audit_pro", "doc_sensitive"): "识别文档中的敏感信息",
    ("document_audit_pro", "doc_illegal"):   "识别文档中的违法违规内容",
    # ── video_audit_pro ──
    ("video_audit_pro", "vid_frame"):     "识别视频画面内容（复用图片审核规则）",
    ("video_audit_pro", "vid_audio"):     "识别视频音轨内容（复用语音审核规则）",
    ("video_audit_pro", "vid_subtitle"):  "识别视频字幕内容（复用文本审核规则）",
    ("video_audit_pro", "vid_illegal"):   "识别视频中的违法违规内容",
}


# Each tuple: (item_code, point_code, label_cn, scope_text, medium, high, risk_level)
# `kind` ∈ {"main", "lib"} controls which config-page table it lands in.
DEFAULT_AUDIT_POINTS: list[tuple[str, str, str, str, str, float, float, str]] = [
    # ---------------- ad_compliance_detection_pro ----------------
    ("ad_compliance_detection_pro", "pt_water_mark", "pt_logotoSocialNetwork", "画面中常见网络社交平台水印",  "画面中常见网络社交平台水印",          50.0, 80.0, "中风险"),
    ("ad_compliance_detection_pro", "pt_water_mark", "pt_logotoSocialNetwork_lib", "自定义水印图库",   "自定义图库用于命中返回该行标签",       50.0, 80.0, "中风险"),
    ("ad_compliance_detection_pro", "pt_qr_code",    "pt_qrCode",                "画面中疑似二维码",        "画面中含二维码",                     50.0, 80.0, "中风险"),
    ("ad_compliance_detection_pro", "pt_qr_code",    "pt_qrCode_lib",            "自定义二维码图库",         "自定义图库用于命中返回该行标签",       50.0, 80.0, "中风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_toDirectContact_tii",   "图中文字联系方式引流",     "图中文字含网址/手机号/微信等联系方式", 60.0, 90.0, "高风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_toSocialNetwork_tii",   "图中文字社交平台引流",     "图中文字含社交平台引流信息",          60.0, 90.0, "高风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_toShortVideos_tii",     "图中文字短视频平台引流",   "图中文字含短视频平台引流信息",        60.0, 90.0, "高风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_investment_tii",        "图中文字投资理财引流",     "图中文字含投资理财引流",             60.0, 90.0, "高风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_recruitment_tii",       "图中文字兼职招聘引流",     "图中文字含兼职招聘引流",             60.0, 90.0, "高风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_certificate_tii",       "图中文字办证套现引流",     "图中文字含办证套现引流",             60.0, 90.0, "高风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_toDirectContact_tii_lib","词库联系方式引流",        "词库用于命中返回该行标签",            55.0, 85.0, "高风险"),
    ("ad_compliance_detection_pro", "pt_drainage",   "pt_toSocialNetwork_tii_lib","词库社交平台引流",        "词库用于命中返回该行标签",            55.0, 85.0, "高风险"),
    # ---------------- image_audit_pro ----------------
    ("image_audit_pro", "img_politics",   "politics_general",     "涉政通用",       "涉政通用：政治人物、政治事件、政治符号",          60.0, 85.0, "高风险"),
    ("image_audit_pro", "img_porn",       "porn_general",         "涉黄通用",       "涉黄通用：裸露、色情、低俗",                       55.0, 85.0, "高风险"),
    ("image_audit_pro", "img_porn",       "porn_general_tii",     "图中色情 OCR",   "图中文字色情 OCR 识别",                            55.0, 80.0, "中风险"),
    ("image_audit_pro", "img_porn",       "porn_general_tii_lib", "词库色情关键词", "词库色情 OCR 关键词",                              50.0, 75.0, "中风险"),
    ("image_audit_pro", "img_porn",       "porn_general_lib",     "自定义涉黄图库", "自定义涉黄图库",                                   50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_violence",   "violence_general",     "涉暴通用",       "涉暴通用：血腥、暴力、武器",                       60.0, 90.0, "高风险"),
    ("image_audit_pro", "img_violence",   "violence_general_lib", "自定义涉暴图库", "自定义涉暴图库",                                   50.0, 80.0, "高风险"),
    # ---- img_prohibited — 截图同款 4-name 模式 (主 + _tii + _lib + _tii_lib) ----
    ("image_audit_pro", "img_prohibited", "contraband_drug",        "违禁药品（画面）",     "画面疑似毒品、药品",                          50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_drug_tii",    "违禁药品（图中文字）", "图中文字疑似描述毒品、违禁品、禁限售等",      50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_drug_lib",    "违禁药品图库",         "图库：选择图库用于命中返回 contraband_drug",   50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_drug_tii_lib","违禁药品词库",         "词库：选择词库用于命中返回 contraband_drug",   50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_gamble",        "违禁赌博（画面）",     "画面疑似赌博物品",                            50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_gamble_tii",    "违禁赌博（图中文字）", "图中文字疑似描述赌博行为",                    50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_gamble_lib",    "违禁赌博图库",         "图库：选择图库用于命中返回 contraband_gamble", 50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_gamble_tii_lib","违禁赌博词库",         "词库：选择词库用于命中返回 contraband_gamble", 50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_weapon",        "违禁器具（画面）",     "画面疑似违禁器具、管制物品",                  50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_weapon_tii",    "违禁器具（图中文字）", "图中文字疑似描述违禁器具、管制物品",          50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_weapon_lib",    "违禁器具图库",         "图库：选择图库用于命中返回 contraband_weapon", 50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_prohibited", "contraband_weapon_tii_lib","违禁器具词库",         "词库：选择词库用于命中返回 contraband_weapon", 50.0, 80.0, "高风险"),
    ("image_audit_pro", "img_terrorism",  "terrorism_general",    "暴恐通用",       "暴恐通用：极端组织符号、爆炸物、恐袭内容",         60.0, 85.0, "高风险"),
    ("image_audit_pro", "img_terrorism",  "terrorism_general_lib","自定义暴恐图库", "自定义暴恐图库",                                   55.0, 85.0, "高风险"),
    ("image_audit_pro", "img_ad",         "ad_general",           "广告通用",       "广告通用：画面含第三方广告或品牌",                 50.0, 75.0, "中风险"),
    ("image_audit_pro", "img_ad",         "ad_general_lib",       "自定义广告图库", "自定义广告图库",                                   50.0, 75.0, "中风险"),
    ("image_audit_pro", "img_adlaw",      "adlaw_general",        "广告法通用",     "广告法通用：极限用语、虚假承诺",                   55.0, 80.0, "高风险"),
    ("image_audit_pro", "img_adlaw",      "adlaw_general_tii",    "图中广告法 OCR", "图中文字广告法违规 OCR",                           55.0, 80.0, "高风险"),
    ("image_audit_pro", "img_adlaw",      "adlaw_general_tii_lib","词库广告法词",   "词库广告法违规关键词",                             50.0, 75.0, "中风险"),
    ("image_audit_pro", "img_adlaw",      "adlaw_general_lib",    "自定义广告法图", "自定义广告法图库",                                 50.0, 75.0, "中风险"),
    ("image_audit_pro", "img_religion",   "religion_general",     "宗教通用",       "宗教通用：宗教符号、宗教极端内容",                 50.0, 75.0, "中风险"),
    ("image_audit_pro", "img_religion",   "religion_general_lib", "自定义宗教图库", "自定义宗教图库",                                   45.0, 70.0, "低风险"),
    ("image_audit_pro", "img_special",    "special_general",      "专项通用",       "专项通用：专项检查任务标识的内容",                 50.0, 75.0, "中风险"),
    ("image_audit_pro", "img_special",    "special_general_lib",  "自定义专项图库", "自定义专项图库",                                   45.0, 70.0, "低风险"),
    # ---------------- text_audit_pro ----------------
    # ---------------- text_audit_pro · 涉政审核（11 个细分点） ----------------
    ("text_audit_pro", "tx_politics", "tx_politics_current_president",   "现任国家主席",       "涉及现任国家主席的影射和负面言论；提及现任国家主席的姓名、职务、亲昵称呼",                                                  60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_former_leaders",       "历任国家核心领导人", "对历任核心领导人（主席、总理）的影射和负面言论；提及历任核心领导人（主席、总理）的姓名、职务、亲昵称呼",                60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_other_domestic_leaders","国内其他主要领导人", "对国内其他主要领导人（正国级、副国级）的负面言论；提及国内其他主要领导人的姓名、职务、亲昵称呼",                        60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_leaders_improper",     "核心领导人不当表述", "不合时宜、不合身份、不合场所地谈论现历任核心领导人",                                                                  60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_foreign_leaders",      "现历任国外领导人",   "提及现任/历任国外领导人",                                                                                                60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_main_forbidden_events","主要政治禁宣事件",   "涉及国内禁止提及的主要政治禁宣事件",                                                                                  60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_other_forbidden_events","其他政治禁宣事件",   "涉及国内禁止提及的其他政治禁宣事件",                                                                                  60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_modern_political",     "近现代政治事件或国际关系", "对近现代中国政治事件、世界形势、国际关系的负面讨论；提及（中国）近现代政治军事事件的名称、组织、人物",            60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_territorial_secession","中国领土分裂",       "宣扬分裂主义言论、支持分裂主义组织、或参与分裂主义活动等论述",                                                            60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_ideology_violation",   "违规的意识形态",     "否定党、国家、政府、制度的观点和思想倾向，对政治政体象征的负面言论和不当表述",                                              60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_politics", "tx_politics_political_entity",     "政治实体",           "提及党组织相关的理论、活动；提及政协会议、国家政策；提及军事装备、活动、组织；提及国家机构、政府机关、公职职务名称",        60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_terrorism",        "tx_terrorism",       "暴恐",                "暴恐违规内容",                60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_porn",             "tx_porn",            "色情",                "色情违规内容",                60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_advertising",      "tx_advertising",     "广告法",              "广告法违规内容",              55.0, 80.0, "高风险"),
    ("text_audit_pro", "tx_abuse",            "tx_abuse",           "辱骂",                "辱骂或人身攻击",              55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_vulgar",           "tx_vulgar",          "低俗",                "低俗内容",                    55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_minor_protection", "tx_minor_protection","未成年保护",          "未成年人保护违规",            55.0, 80.0, "高风险"),
    ("text_audit_pro", "tx_values",           "tx_values",          "价值观",              "价值观违规",                  55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_illegal",          "tx_illegal",         "违法违规",            "违法违规",                    60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_privacy",          "tx_privacy_pii",     "PII 检测",            "PII 检测：身份证/手机/银行卡", 60.0, 85.0, "敏感"),
    ("text_audit_pro", "tx_privacy",          "tx_privacy_contact", "联系方式检测",        "联系方式检测：地址/邮箱/微信", 55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_promptattack",     "tx_promptattack_basic","基础越狱指令",      "基础越狱指令识别",          70.0, 90.0, "高风险"),
    ("text_audit_pro", "tx_promptattack",     "tx_promptattack_adv", "高级越狱指令",        "高级越狱指令识别",            65.0, 85.0, "高风险"),
    # ---------------- text_audit_pro · 不良内容审核（聚合 1 个 item，下挂 7 个 audit_point） ----------------
    ("text_audit_pro", "bad", "bad_minor",         "未成年不适",   "识别画面/文本中未成年人涉烟酒、纹身、恋爱、裸露、暴力等不当场景",                              60.0, 85.0, "高风险"),
    ("text_audit_pro", "bad", "bad_bias",          "偏见歧视",     "识别种族/民族/地域/性别/职业/宗教/性取向等歧视性内容",                                          60.0, 85.0, "高风险"),
    ("text_audit_pro", "bad", "bad_values",        "不良价值观",   "识别拜金/炫富/躺平摆烂/啃老/畸形审美/崇洋媚外等扭曲价值观",                                  60.0, 85.0, "高风险"),
    ("text_audit_pro", "bad", "bad_abuse",         "攻击辱骂",     "识别画面/文本中人身攻击/P图丑化/恶意诅咒/阴阳怪气/PUA话术",                                60.0, 85.0, "高风险"),
    ("text_audit_pro", "bad", "bad_vulgar",        "低俗口头语",   "识别粗口/脏话/谐音脏话/缩写脏话/网络黑话脏话",                                              60.0, 85.0, "高风险"),
    ("text_audit_pro", "bad", "bad_superstition",  "封建迷信",     "识别算命/占卜/看相/测字/跳大神/巫术/伪科学养生/转运改命/邪教组织",                            60.0, 85.0, "高风险"),
    ("text_audit_pro", "bad", "bad_spam",          "无意义灌水",   "识别大量重复字符/无意义符号堆叠/纯水贴/凑字数/低质水文",                                  55.0, 80.0, "高风险"),
    # ---------------- audio_audit_pro ----------------
    ("audio_audit_pro", "au_politics",      "au_politics_general",  "语音涉政",       "语音中涉政表述",              60.0, 85.0, "高风险"),
    ("audio_audit_pro", "au_porn",          "au_porn_general",      "语音色情",       "语音中含色情表述",            60.0, 85.0, "高风险"),
    ("audio_audit_pro", "au_violence",      "au_violence_general",  "语音暴恐",       "语音中含暴恐表述",            60.0, 85.0, "高风险"),
    ("audio_audit_pro", "au_adlaw",         "au_adlaw_general",     "语音广告法",     "语音中广告法违规词",          55.0, 80.0, "高风险"),
    ("audio_audit_pro", "au_abuse",         "au_abuse_general",     "语音辱骂",       "语音中辱骂内容",              55.0, 80.0, "中风险"),
    ("audio_audit_pro", "au_minor",         "au_minor_general",     "语音未成年保护", "语音中未成年保护违规",        55.0, 80.0, "高风险"),
    ("audio_audit_pro", "au_illegal",       "au_illegal_general",   "语音违法违规",   "语音中违法违规表述",          60.0, 85.0, "高风险"),
    ("audio_audit_pro", "au_voiceprint",    "au_voiceprint_moaning",   "娇喘检测",   "识别语音中的娇喘等异常发声模式",  60.0, 85.0, "中风险"),
    ("audio_audit_pro", "au_audiopquality", "au_audiopquality_no_speech","无语音内容", "识别音频中无有效语音内容",     50.0, 75.0, "低风险"),
    # ---------------- document_audit_pro ----------------
    ("document_audit_pro", "doc_image",     "doc_image_general", "文档图片审核",   "文档中嵌入图片内容审核",      55.0, 80.0, "中风险"),
    ("document_audit_pro", "doc_text",      "doc_text_general",  "文档文本审核",   "文档中文本内容审核",          55.0, 80.0, "中风险"),
    ("document_audit_pro", "doc_sensitive", "doc_sensitive",     "文档敏感信息",   "文档中敏感信息检测",          60.0, 85.0, "高风险"),
    ("document_audit_pro", "doc_illegal",   "doc_illegal",       "文档违法违规",   "文档中违法违规内容",          60.0, 85.0, "高风险"),
    # ---------------- video_audit_pro ----------------
    ("video_audit_pro", "vid_frame",     "vid_frame_general", "视频画面审核",  "视频画面内容审核",          55.0, 80.0, "中风险"),
    ("video_audit_pro", "vid_audio",     "vid_audio_general", "视频音轨审核",  "视频音轨内容审核",          55.0, 80.0, "中风险"),
    ("video_audit_pro", "vid_subtitle",  "vid_subtitle",      "视频字幕审核",  "视频字幕内容审核",          55.0, 80.0, "中风险"),
    ("video_audit_pro", "vid_illegal",   "vid_illegal",       "视频违法违规",  "视频违法违规内容",          60.0, 85.0, "高风险"),
]


async def _upsert_audit_items(db: AsyncSession) -> int:
    """Upsert DEFAULT_AUDIT_ITEMS into audit_items. Idempotent."""
    created = 0
    for package_code, items in DEFAULT_AUDIT_ITEMS.items():
        for item_code, (name_cn, aliases, small_category) in items.items():
            description = DEFAULT_ITEM_DESCRIPTIONS.get((package_code, item_code))
            existing = await db.execute(
                select(AuditItem).where(
                    AuditItem.package_code == package_code,
                    AuditItem.code == item_code,
                )
            )
            row = existing.scalar_one_or_none()
            if row:
                row.name_cn = name_cn
                row.aliases = aliases
                row.is_enabled = True
                row.is_builtin = True
                row.small_category = small_category
                if description is not None:
                    row.description = description
            else:
                db.add(
                    AuditItem(
                        package_code=package_code,
                        code=item_code,
                        name_cn=name_cn,
                        aliases=aliases,
                        small_category=small_category,
                        description=description,
                        sort_order=0,
                        is_enabled=True,
                        is_builtin=True,
                    )
                )
                created += 1
    if created > 0:
        await db.flush()
    return created


async def _upsert_audit_points(db: AsyncSession) -> int:
    """Upsert DEFAULT_AUDIT_POINTS into audit_points. Idempotent."""
    created = 0

    # Pre-fetch item_id by (package_code, item_code) so we can attach points.
    items_result = await db.execute(select(AuditItem))
    items = list(items_result.scalars())
    item_by_key: dict[tuple[str, str], int] = {
        (it.package_code, it.code): it.id for it in items if it.id is not None
    }

    for (
        package_code,
        item_code,
        point_code,
        label_cn,
        scope_text,
        medium,
        high,
        risk_str,
    ) in DEFAULT_AUDIT_POINTS:
        item_id = item_by_key.get((package_code, item_code))
        if item_id is None:
            continue

        existing = await db.execute(
            select(AuditPoint).where(
                AuditPoint.package_code == package_code,
                AuditPoint.code == point_code,
            )
        )
        row = existing.scalar_one_or_none()
        risk_enum = AuditPointRisk(risk_str)
        if row:
            row.item_id = item_id
            row.label = point_code
            row.label_cn = label_cn
            row.description = None
            row.scope_text = scope_text
            row.medium_threshold = medium
            row.high_threshold = high
            row.risk_level = risk_enum
            row.is_enabled = True
            row.is_builtin = True
        else:
            db.add(
                AuditPoint(
                    package_code=package_code,
                    item_id=item_id,
                    code=point_code,
                    label=point_code,
                    label_cn=label_cn,
                    description=None,
                    scope_text=scope_text,
                    medium_threshold=medium,
                    high_threshold=high,
                    risk_level=risk_enum,
                    is_enabled=True,
                    is_builtin=True,
                    sort_order=0,
                )
            )
            created += 1
    if created > 0:
        await db.flush()
    return created


async def _purge_orphan_audit_data(
    db: AsyncSession, *, apply: bool = False, dry_run: bool = False
) -> tuple[int, int]:
    """Removes orphan audit_items / audit_points that are NOT in the seed whitelist.

    Keeps audit_items that match a DEFAULT_AUDIT_ITEMS key (package, code)
    and audit_points that match a DEFAULT_AUDIT_POINTS key (package, code).
    Anything extra is from a previous schema and is removed.

    默认 apply=False → no-op，仅打印白名单内外的差异。
    真删需要 apply=True 且 dry_run=False（CLI: --purge-user-data --apply）。
    """
    if not apply and not dry_run:
        return 0, 0
    item_whitelist = {
        (pkg, code) for pkg, items in DEFAULT_AUDIT_ITEMS.items() for code in items
    }
    point_whitelist = {
        (pkg, pc) for (pkg, _ic, pc, *_rest) in DEFAULT_AUDIT_POINTS
    }

    items_result = await db.execute(select(AuditItem))
    all_items = list(items_result.scalars())
    items_to_delete = [
        it for it in all_items if (it.package_code, it.code) not in item_whitelist
    ]
    points_result = await db.execute(select(AuditPoint))
    all_points = list(points_result.scalars())
    points_to_delete = [
        p for p in all_points if (p.package_code, p.code) not in point_whitelist
    ]

    if dry_run or not apply:
        print(
            f"[purge-user-data][dry-run] will delete "
            f"{len(items_to_delete)} audit_items, {len(points_to_delete)} audit_points"
        )
        for it in items_to_delete[:10]:
            print(f"   - item: ({it.package_code}, {it.code})")
        for p in points_to_delete[:10]:
            print(f"   - point: ({p.package_code}, {p.code})")
        if len(items_to_delete) > 10 or len(points_to_delete) > 10:
            print(f"   ... ({abs(len(items_to_delete) - 10) if len(items_to_delete) > 10 else 0} more items, "
                  f"{abs(len(points_to_delete) - 10) if len(points_to_delete) > 10 else 0} more points)")
        return len(items_to_delete), len(points_to_delete)

    # Clear any detection_rules FK bridging to orphan audit_points.
    orphan_point_ids = {p.id for p in points_to_delete if p.id is not None}
    if orphan_point_ids:
        await db.execute(
            DetectionRule.__table__.update()
            .where(DetectionRule.audit_point_id.in_(orphan_point_ids))
            .values(audit_point_id=None)
        )

    for p in points_to_delete:
        await db.delete(p)
    for it in items_to_delete:
        await db.delete(it)
    await db.flush()
    return len(items_to_delete), len(points_to_delete)


async def _upsert_sample_triggers(db) -> None:
    """Insert one sample trigger (disabled by default — admin enables after review).

    The sample exercises both cron scheduling and 5-key match conditions
    so admins can verify routing end-to-end before enabling.
    """
    from sqlalchemy import select

    existing = await db.scalar(select(Trigger).where(Trigger.code == "sample_full_scan"))
    if existing is not None:
        return

    # Only create if the 'hybrid' template actually exists in this DB.
    tpl = await db.scalar(
        select(WorkflowTemplate).where(
            WorkflowTemplate.code == "hybrid",
            WorkflowTemplate.is_active.is_(True),
        )
    )
    if tpl is None:
        return

    trigger = Trigger(
        code="sample_full_scan",
        name="示例 - 全量文本巡检（未启用）",
        trigger_type="cron",
        is_enabled=False,
        spec={
            "cron": "0 2 * * *",
            "timezone": "Asia/Shanghai",
            "repeat": "daily",
            "time": "02:00",
        },
        workflow_template_code="hybrid",
        strategy_id=None,
        match_conditions={"material_type": ["text"]},
        scan_interval_sec=60,
        created_by=None,
    )
    db.add(trigger)
    print("seed: inserted sample trigger 'sample_full_scan' (disabled)")


async def main(
    *,
    purge_removed: bool = False,
    purge_user_data: bool = False,
    dry_run: bool = False,
) -> None:
    """Seed entrypoint.

    默认行为：仅 upsert 默认数据，不删任何用户态行。

    破坏性操作（显式 opt-in）：
      --purge-removed  + --apply : 删除白名单外的 services / detection_rules / human_review_configs / audit_points / audit_items
      --purge-user-data + --apply : 删除未在 DEFAULT_AUDIT_ITEMS/POINTS 白名单的 audit_items / audit_points
      --dry-run : 与上述任意开关组合，只打印将删除什么，不真的 DELETE
    """
    purge_apply = (purge_removed or purge_user_data) and not dry_run

    async with SessionLocal() as db:
        await _upsert_templates(db)
        await _upsert_default_strategy(db)
        await _upsert_categories(db)
        await db.flush()
        await _upsert_services(db)
        await db.flush()
        await _purge_removed_services(
            db, apply=purge_removed, dry_run=(dry_run and purge_removed)
        )
        await db.flush()
        await _upsert_wordsets(db)
        await _upsert_detection_rules(db)
        await db.flush()
        items_created = await _upsert_audit_items(db)
        points_created = await _upsert_audit_points(db)
        items_purged, points_purged = await _purge_orphan_audit_data(
            db, apply=purge_user_data, dry_run=(dry_run and purge_user_data)
        )
        await _upsert_human_review_configs(db)
        await _upsert_tags(db)
        await _upsert_bad_libraries(db)
        await _upsert_politics_libraries(db)
        await _upsert_user(db, "admin@adreview.example.com", "系统管理员", UserRole.ADMIN, settings.default_admin_password)
        await _upsert_user(db, "reviewer@adreview.example.com", "审核员 Alice", UserRole.REVIEWER, "reviewer123")
        await _upsert_user(db, "mlr@adreview.example.com", "MLR 专家 Bob", UserRole.MLR, "mlr12345")
        await _upsert_user(db, "submitter@adreview.example.com", "提交者 Carol", UserRole.SUBMITTER, "submitter123")
        await _upsert_user(db, "superadmin@adreview.example.com", "超级管理员", UserRole.SUPERADMIN, settings.default_superadmin_password)
        await _upsert_user(db, "rootadmin@adreview.example.com", "根管理员", UserRole.ROOT_ADMIN, settings.default_root_admin_password)
        await _upsert_sample_triggers(db)
        await db.commit()
        from app.db.session import engine
        await engine.dispose()
        if not dry_run and not purge_apply:
            print(
                f"seed complete (safe mode — no purge). "
                f"audit_items={items_created} created, audit_points={points_created} created. "
                f"Use --purge-removed or --purge-user-data to clean orphan rows (default skips this)."
            )
        elif dry_run:
            print(
                f"seed complete (dry-run). "
                f"audit_items={items_created} upserted, audit_points={points_created} upserted. "
                f"No rows were deleted. Run without --dry-run to actually purge."
            )
        else:
            print(
                f"seed complete. audit_items={items_created} created (purged={items_purged}) "
                f"audit_points={points_created} created (purged={points_purged})"
            )


async def _upsert_human_review_configs(db: AsyncSession) -> None:
    """默认给每个启用的审核服务初始化人机审核配置。"""
    default_service_codes = ("ad_compliance_detection_pro", "text_audit_pro")
    for code in default_service_codes:
        result = await db.execute(
            select(HumanReviewConfig).where(
                HumanReviewConfig.service_code == code
            )
        )
        cfg = result.scalar_one_or_none()
        if not cfg:
            db.add(
                HumanReviewConfig(
                    service_code=code,
                    is_enabled=False,
                    risk_levels="",
                    review_rule_id=None,
                )
            )


DEFAULT_TAGS = [
    {"code": "tag_politics_figure", "name": "政治人物", "domain": TagDomain.POLITICS, "category": TagCategory.FIGURE},
    {"code": "tag_politics_event", "name": "政治事件", "domain": TagDomain.POLITICS, "category": TagCategory.EVENT},
    {"code": "tag_porn_image", "name": "色情图像", "domain": TagDomain.PORN, "category": TagCategory.SCENE},
    {"code": "tag_violence_scene", "name": "暴力场景", "domain": TagDomain.VIOLENCE, "category": TagCategory.SCENE},
    {"code": "tag_ads_absolute", "name": "绝对化用语", "domain": TagDomain.ADS_LAW, "category": TagCategory.ABSOLUTE_TERM},
    {"code": "tag_ads_credential", "name": "缺失资质", "domain": TagDomain.ADS_LAW, "category": TagCategory.CREDENTIAL},
    {"code": "tag_medical_claim", "name": "医疗宣称", "domain": TagDomain.MEDICAL, "category": TagCategory.CLAIM},
    {"code": "tag_finance_promise", "name": "金融承诺", "domain": TagDomain.FINANCE, "category": TagCategory.SLOGAN},
    {"code": "tag_minor_image", "name": "未成年人形象", "domain": TagDomain.MINOR, "category": TagCategory.FIGURE},
    {"code": "tag_privacy_leak", "name": "隐私泄露", "domain": TagDomain.PRIVACY, "category": TagCategory.SCENE},
    {"code": "tag_ip_logo", "name": "品牌 logo", "domain": TagDomain.IP, "category": TagCategory.SYMBOL},
    {"code": "tag_fraud_claim", "name": "欺诈话术", "domain": TagDomain.FRAUD, "category": TagCategory.CLAIM},
]


# ---------- 不良内容审核默认词库（占位） ----------
# 为 text_audit_pro.bad item 下 7 个 audit_point 各创建一个空 word 词库，
# 方便运营在「知识库 → 词库」中直接看到并填充关键词。
# 不会自动关联到 audit_point（按用户要求"暂不关联库"）；运营后续在
# ServiceRuleConfigPage 的「关联库」列手动绑定即可。
DEFAULT_BAD_LIBRARIES: list[dict[str, str]] = [
    {"code": "lib_w_bad_minor",         "name": "不良词库-未成年不适",   "description": "未成年人涉烟酒、纹身、恋爱、裸露、暴力等不当场景关键词"},
    {"code": "lib_w_bad_bias",          "name": "不良词库-偏见歧视",     "description": "种族/民族/地域/性别/职业/宗教/性取向等歧视性关键词"},
    {"code": "lib_w_bad_values",        "name": "不良词库-不良价值观",   "description": "拜金/炫富/躺平摆烂/啃老/畸形审美/崇洋媚外等扭曲价值观关键词"},
    {"code": "lib_w_bad_abuse",         "name": "不良词库-攻击辱骂",     "description": "人身攻击/恶意诅咒/阴阳怪气/PUA话术关键词"},
    {"code": "lib_w_bad_vulgar",        "name": "不良词库-低俗口头语",   "description": "粗口/脏话/谐音脏话/缩写脏话/网络黑话脏话"},
    {"code": "lib_w_bad_superstition",  "name": "不良词库-封建迷信",     "description": "算命/占卜/看相/测字/跳大神/巫术/伪科学养生/转运改命/邪教组织关键词"},
    {"code": "lib_w_bad_spam",          "name": "不良词库-无意义灌水",   "description": "大量重复字符/无意义符号堆叠/纯水贴/凑字数/低质水文关键词"},
]


# ---------- 涉政审核默认词库（占位） ----------
# 为 text_audit_pro.tx_politics item 下 11 个 audit_point 各创建一个空 word 词库，
# 方便运营在「知识库 → 词库」中直接看到并填充关键词。
# 不会自动关联到 audit_point（按"暂不关联库"约定）；运营后续在
# ServiceRuleConfigPage 的「关联库」列手动绑定即可。
DEFAULT_POLITICS_LIBRARIES: list[dict[str, str]] = [
    {"code": "lib_w_politics_current_president",     "name": "涉政词库-现任国家主席",     "description": "现任国家主席的姓名、职务、亲昵称呼及影射/负面言论关键词"},
    {"code": "lib_w_politics_former_leaders",        "name": "涉政词库-历任国家核心领导人", "description": "历任核心领导人（主席、总理）的姓名、职务、亲昵称呼及影射/负面言论关键词"},
    {"code": "lib_w_politics_other_domestic_leaders","name": "涉政词库-国内其他主要领导人", "description": "正国级/副国级国内其他主要领导人姓名、职务、亲昵称呼及负面言论关键词"},
    {"code": "lib_w_politics_leaders_improper",      "name": "涉政词库-核心领导人不当表述", "description": "不合时宜/不合身份/不合场所谈论现历任核心领导人的不当表述关键词"},
    {"code": "lib_w_politics_foreign_leaders",       "name": "涉政词库-现历任国外领导人",   "description": "现任/历任国外领导人姓名及关联关键词"},
    {"code": "lib_w_politics_main_forbidden_events", "name": "涉政词库-主要政治禁宣事件",   "description": "国内禁止提及的主要政治禁宣事件相关关键词"},
    {"code": "lib_w_politics_other_forbidden_events","name": "涉政词库-其他政治禁宣事件",   "description": "国内禁止提及的其他政治禁宣事件相关关键词"},
    {"code": "lib_w_politics_modern_political",      "name": "涉政词库-近现代政治事件或国际关系", "description": "近现代中国政治事件、世界形势、国际关系相关负面表述及政治军事事件/组织/人物关键词"},
    {"code": "lib_w_politics_territorial_secession", "name": "涉政词库-中国领土分裂",       "description": "分裂主义言论、支持分裂主义组织、参与分裂主义活动相关关键词"},
    {"code": "lib_w_politics_ideology_violation",    "name": "涉政词库-违规的意识形态",     "description": "否定党/国家/政府/制度的观点、政治政体象征负面言论及不当表述关键词"},
    {"code": "lib_w_politics_political_entity",      "name": "涉政词库-政治实体",           "description": "党组织理论/活动、政协会议、国家政策、军事装备/活动/组织、国家机构/政府机关/公职职务名称关键词"},
]


async def _upsert_bad_libraries(db: AsyncSession) -> None:
    """Ensure 7 empty word libraries (默认黑名单) exist (idempotent)."""
    for spec in DEFAULT_BAD_LIBRARIES:
        lib = (
            await db.execute(
                select(Library).where(Library.code == spec["code"])
            )
        ).scalars().first()
        if lib:
            lib.name = spec["name"]
            lib.description = spec["description"]
            lib.kind = LibraryKind.BLACKLIST
            lib.is_active = True
            # 标记为通用平台库:仅超级管理员可见可改可删
            lib.is_platform = True
        else:
            db.add(
                Library(
                    code=spec["code"],
                    name=spec["name"],
                    library_type=LibraryType.WORD,
                    kind=LibraryKind.BLACKLIST,
                    description=spec["description"],
                    is_active=True,
                    is_deleted=False,
                    is_platform=True,
                    ignored_services=[],
                )
            )


async def _upsert_politics_libraries(db: AsyncSession) -> None:
    """Ensure 11 empty word libraries (默认黑名单) exist (idempotent)."""
    for spec in DEFAULT_POLITICS_LIBRARIES:
        lib = (
            await db.execute(
                select(Library).where(Library.code == spec["code"])
            )
        ).scalars().first()
        if lib:
            lib.name = spec["name"]
            lib.description = spec["description"]
            lib.kind = LibraryKind.BLACKLIST
            lib.is_active = True
            lib.is_platform = True
        else:
            db.add(
                Library(
                    code=spec["code"],
                    name=spec["name"],
                    library_type=LibraryType.WORD,
                    kind=LibraryKind.BLACKLIST,
                    description=spec["description"],
                    is_active=True,
                    is_deleted=False,
                    is_platform=True,
                    ignored_services=[],
                )
            )


async def _upsert_tags(db: AsyncSession) -> None:
    """种一批 active 标签，供审核员在人工标注面板选用。"""
    for spec in DEFAULT_TAGS:
        existing = (
            await db.execute(select(Tag).where(Tag.code == spec["code"]))
        ).scalars().first()
        if existing:
            continue
        db.add(
            Tag(
                code=spec["code"],
                name=spec["name"],
                domain=spec["domain"],
                category=spec["category"],
                jurisdictions=["cn"],
                industries=[],
                channels=[],
                status=TagStatus.ACTIVE,
                version=1,
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Seed default data. Default: upsert only, never delete user data.",
    )
    parser.add_argument(
        "--purge-removed",
        action="store_true",
        help="Delete services NOT in DEFAULT_SERVICES (cascades to detection_rules, "
             "human_review_configs, audit_points, audit_items). Opt-in for deletion.",
    )
    parser.add_argument(
        "--purge-user-data",
        action="store_true",
        help="Delete audit_items / audit_points NOT in seed whitelist.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be deleted; do not actually DELETE rows.",
    )
    parser.add_argument(
        "--allow-reseed",
        action="store_true",
        help=argparse.SUPPRESS,  # advanced: paired with RESEED_ALLOWED + --reason
    )
    args = parser.parse_args()

    # ──────────────────────────────────────────────────────────────────
    # Safety gate: refuse to run on a DB that already has user data.
    #
    # History: a developer (or typo) ran plain `python scripts/seed.py`
    # against a populated DB on 2026-07-12 16:30, silently overwriting
    # manually-imported audit points back to DEFAULT_* values. The
    # project rule is: NEVER re-seed a live DB. To run seed.py at all,
    # the operator must supply BOTH:
    #
    #   1. RESEED_ALLOWED=YES  (env var, exact match)
    #   2. --allow-reseed     (CLI flag, hidden behind SUPPRESS)
    #
    # Plain `python scripts/seed.py` on a non-empty DB will refuse and
    # print a remediation hint.
    #
    # The check is on COUNT(*) of audit_items / strategies / libraries
    # — any of which being non-zero means "live data is present".
    # ──────────────────────────────────────────────────────────────────
    from sqlalchemy import text as _sa_text  # local import to avoid top-level noise
    from sqlalchemy.ext.asyncio import create_async_engine as _cae

    async def _has_user_data() -> bool:
        async with engine.begin() as conn:
            res = await conn.execute(
                _sa_text(
                    "SELECT (SELECT count(*) FROM audit_items) + "
                    "       (SELECT count(*) FROM strategies) + "
                    "       (SELECT count(*) FROM libraries)"
                )
            )
            row = res.scalar_one()
            return (row or 0) > 0

    reseed_armed = (
        os.environ.get("RESEED_ALLOWED") == "YES" and args.allow_reseed
    )

    if not reseed_armed:
        try:
            has_data = asyncio.run(_has_user_data())
        except Exception:
            has_data = False
        if has_data:
            print("=" * 72, file=sys.stderr)
            print("  ✗ seed.py REFUSED to run.", file=sys.stderr)
            print("", file=sys.stderr)
            print(
                "  This database already has user data (audit_items / strategies /\n"
                "  libraries count > 0). Running seed.py on a populated database\n"
                "  overwrites manually-imported audit points / items / thresholds\n"
                "  back to the bundled DEFAULT_* values. See CLAUDE.md for the\n"
                "  project policy that forbids this.",
                file=sys.stderr,
            )
            print("", file=sys.stderr)
            print("  To bypass (e.g. on a fresh empty DB):", file=sys.stderr)
            print(
                "    RESEED_ALLOWED=YES python scripts/seed.py --allow-reseed",
                file=sys.stderr,
            )
            print("", file=sys.stderr)
            print(
                "  To preview what seed would touch without writing:",
                file=sys.stderr,
            )
            print("    python scripts/seed.py --dry-run", file=sys.stderr)
            print("=" * 72, file=sys.stderr)
            # Audit the refusal — best effort; never raises.
            try:
                from app.core.ops_log import record_op

                record_op(
                    action="scripts.seed.run",
                    status="refused",
                    detail={
                        "argv": sys.argv,
                        "env_RESEED_ALLOWED": os.environ.get("RESEED_ALLOWED"),
                        "env_SEED_CONFIRM_DELETE": os.environ.get(
                            "SEED_CONFIRM_DELETE"
                        ),
                        "args_purge_removed": args.purge_removed,
                        "args_purge_user_data": args.purge_user_data,
                        "args_dry_run": args.dry_run,
                        "args_allow_reseed": args.allow_reseed,
                        "reason": "non-empty DB without RESEED_ALLOWED+--allow-reseed",
                    },
                    message="seed.py refused: live-data guard tripped",
                )
            except Exception:
                pass
            sys.exit(2)

    if (args.purge_removed or args.purge_user_data) and not args.dry_run:
        print(
            "WARNING: This will DELETE rows from production tables.",
            file=sys.stderr,
        )
        print(
            "Re-run with --dry-run first to preview, or set SEED_CONFIRM_DELETE=YES "
            "to skip this confirmation in non-TTY mode.",
            file=sys.stderr,
        )
        if sys.stdin.isatty():
            try:
                reply = input("Type 'yes' to continue: ").strip().lower()
            except EOFError:
                reply = ""
            if reply != "yes":
                print("Aborted.", file=sys.stderr)
                sys.exit(1)
        elif os.environ.get("SEED_CONFIRM_DELETE") != "YES":
            print(
                "Refusing to run purge without --dry-run in non-interactive mode "
                "(set SEED_CONFIRM_DELETE=YES to override).",
                file=sys.stderr,
            )
            sys.exit(1)

    lock_path = "/tmp/adreview.seed.lock"
    lock_fd = open(lock_path, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Another seed.py is already running (lock file held).", file=sys.stderr)
        sys.exit(1)

    # Audit: record the attempt as 'started' before main(), flip to
    # 'succeeded' on clean exit or 'failed' on exception.
    try:
        from app.core.ops_log import record_op

        record_op(
            action="scripts.seed.run",
            status="started",
            detail={
                "argv": sys.argv,
                "env_RESEED_ALLOWED": os.environ.get("RESEED_ALLOWED"),
                "env_SEED_CONFIRM_DELETE": os.environ.get("SEED_CONFIRM_DELETE"),
                "args_purge_removed": args.purge_removed,
                "args_purge_user_data": args.purge_user_data,
                "args_dry_run": args.dry_run,
                "args_allow_reseed": args.allow_reseed,
            },
        )
    except Exception:
        pass

    run_status = "succeeded"
    try:
        try:
            asyncio.run(main(
                purge_removed=args.purge_removed,
                purge_user_data=args.purge_user_data,
                dry_run=args.dry_run,
            ))
        except SystemExit as _ex:
            run_status = "aborted"
            raise
        except Exception as _ex:
            run_status = "failed"
            try:
                from app.core.ops_log import record_op

                record_op(
                    action="scripts.seed.run",
                    status="failed",
                    detail={"argv": sys.argv, "error": repr(_ex)},
                )
            except Exception:
                pass
            raise
        else:
            try:
                from app.core.ops_log import record_op

                record_op(
                    action="scripts.seed.run",
                    status=("dry-run" if args.dry_run else "succeeded"),
                    detail={
                        "argv": sys.argv,
                        "purge_removed": args.purge_removed,
                        "purge_user_data": args.purge_user_data,
                        "dry_run": args.dry_run,
                    },
                )
            except Exception:
                pass
    finally:
        try:
            os.unlink(lock_path)
        except OSError:
            pass
