"""Seed initial data: roles represented via users + default workflow templates + default strategy + service catalog."""
import asyncio

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
from app.models.detection_rule import DetectionRule
from app.models.human_review_config import HumanReviewConfig
from app.models.tag import Tag, TagCategory, TagDomain, TagSource, TagStatus
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint, AuditPointRisk


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
            priority=99,
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


async def _purge_removed_services(db: AsyncSession) -> None:
    """Delete services whose code is no longer in DEFAULT_SERVICES.

    Cascades FK cleanup on detection_rules / human_review_configs /
    audit_points / audit_items and prunes stale service codes from
    strategies.definition.services[].
    """
    allowed_codes = {s["code"] for s in DEFAULT_SERVICES}
    result = await db.execute(select(Service.code))
    existing_codes = {row[0] for row in result.all()}
    stale_codes = existing_codes - allowed_codes
    if not stale_codes:
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
DEFAULT_AUDIT_ITEMS: dict[str, dict[str, tuple[str, list[str]]]] = {
    "ad_compliance_detection_pro": {
        "pt_water_mark": ("水印", ["水印", "logo", "watermark"]),
        "pt_qr_code":    ("二维码", ["二维码", "qrcode", "QR码", "小程序码"]),
        "pt_drainage":   ("引流", ["引流", "联系方式", "兼职招聘", "办证", "投资理财"]),
    },
    "image_audit_pro": {
        "img_politics":   ("涉政",   ["涉政", "政治敏感", "politics"]),
        "img_porn":       ("涉黄",   ["涉黄", "色情", "porn", "低俗"]),
        "img_violence":   ("涉暴",   ["涉暴", "暴力", "血腥", "violence"]),
        "img_prohibited": ("违禁",   ["违禁", "毒品", "赌博", "prohibited"]),
        "img_terrorism":  ("暴恐",   ["暴恐", "恐怖", "terrorism"]),
        "img_ad":         ("广告",   ["广告", "advertisement"]),
        "img_adlaw":      ("广告法", ["广告法", "极限用语", "adlaw"]),
        "img_religion":   ("宗教",   ["宗教", "religion"]),
        "img_special":    ("专项",   ["专项", "special"]),
    },
    "text_audit_pro": {
        "tx_politics":         ("涉政",       ["涉政", "政治敏感", "politics"]),
        "tx_terrorism":        ("暴恐",       ["暴恐", "恐怖", "terrorism"]),
        "tx_porn":             ("色情",       ["色情", "低俗", "porn"]),
        "tx_advertising":      ("广告法",     ["广告法", "极限用语"]),
        "tx_abuse":            ("辱骂",       ["辱骂", "谩骂", "abuse"]),
        "tx_vulgar":           ("低俗",       ["低俗", "vulgar"]),
        "tx_minor_protection": ("未成年保护", ["未成年", "minor"]),
        "tx_values":           ("价值观",     ["价值观", "values"]),
        "tx_illegal":          ("违法违规",   ["违法", "illegal"]),
        "tx_privacy":          ("隐私信息",   ["隐私", "个人信息", "privacy"]),
        "tx_promptattack":     ("prompt攻击", ["prompt", "jailbreak"]),
    },
    "audio_audit_pro": {
        "au_politics":   ("涉政",     ["涉政", "politics"]),
        "au_porn":       ("色情",     ["色情", "porn"]),
        "au_violence":   ("暴恐",     ["暴恐", "terrorism"]),
        "au_adlaw":      ("广告法",   ["广告法", "adlaw"]),
        "au_abuse":      ("辱骂",     ["辱骂", "abuse"]),
        "au_minor":      ("未成年保护", ["未成年", "minor"]),
        "au_illegal":    ("违法违规", ["违法", "illegal"]),
    },
    "document_audit_pro": {
        "doc_image":     ("图片内容",   ["图片内容", "图片审核"]),
        "doc_text":      ("文本内容",   ["文本内容", "文本审核"]),
        "doc_sensitive": ("敏感信息",   ["敏感", "sensitive"]),
        "doc_illegal":   ("违法违规",   ["违法", "illegal"]),
    },
    "video_audit_pro": {
        "vid_frame":     ("画面内容",   ["画面内容", "图片审核"]),
        "vid_audio":     ("音轨内容",   ["音轨内容", "语音审核"]),
        "vid_subtitle":  ("字幕内容",   ["字幕内容", "文本审核"]),
        "vid_illegal":   ("违法违规",   ["违法", "illegal"]),
    },
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
    ("image_audit_pro", "img_politics",   "politics_general_lib", "自定义涉政图库", "自定义涉政图库：词库用于命中返回该行标签",        55.0, 80.0, "高风险"),
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
    ("text_audit_pro", "tx_politics",         "tx_politics",        "涉政",                "涉政违规内容",                60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_terrorism",        "tx_terrorism",       "暴恐",                "暴恐违规内容",                60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_porn",             "tx_porn",            "色情",                "色情违规内容",                60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_advertising",      "tx_advertising",     "广告法",              "广告法违规内容",              55.0, 80.0, "高风险"),
    ("text_audit_pro", "tx_abuse",            "tx_abuse",           "辱骂",                "辱骂或人身攻击",              55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_vulgar",           "tx_vulgar",          "低俗",                "低俗内容",                    55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_minor_protection", "tx_minor_protection","未成年保护",          "未成年人保护违规",            55.0, 80.0, "高风险"),
    ("text_audit_pro", "tx_values",           "tx_values",          "价值观",              "价值观违规",                  55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_illegal",          "tx_illegal",         "违法违规",            "违法违规",                    60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_privacy",          "tx_privacy_pii",     "PII 检测",            "PII 检测：身份证/手机/银行卡", 60.0, 85.0, "高风险"),
    ("text_audit_pro", "tx_privacy",          "tx_privacy_contact", "联系方式检测",        "联系方式检测：地址/邮箱/微信", 55.0, 80.0, "中风险"),
    ("text_audit_pro", "tx_promptattack",     "tx_promptattack_basic","基础越狱指令",      "基础越狱指令识别",          70.0, 90.0, "高风险"),
    ("text_audit_pro", "tx_promptattack",     "tx_promptattack_adv", "高级越狱指令",        "高级越狱指令识别",            65.0, 85.0, "高风险"),
    # ---------------- audio_audit_pro ----------------
    ("audio_audit_pro", "au_politics", "au_politics_general",  "语音涉政",       "语音中涉政表述",              60.0, 85.0, "高风险"),
    ("audio_audit_pro", "au_porn",     "au_porn_general",      "语音色情",       "语音中含色情表述",            60.0, 85.0, "高风险"),
    ("audio_audit_pro", "au_violence", "au_violence_general",  "语音暴恐",       "语音中含暴恐表述",            60.0, 85.0, "高风险"),
    ("audio_audit_pro", "au_adlaw",    "au_adlaw_general",     "语音广告法",     "语音中广告法违规词",          55.0, 80.0, "高风险"),
    ("audio_audit_pro", "au_abuse",    "au_abuse_general",     "语音辱骂",       "语音中辱骂内容",              55.0, 80.0, "中风险"),
    ("audio_audit_pro", "au_minor",    "au_minor_general",     "语音未成年保护", "语音中未成年保护违规",        55.0, 80.0, "高风险"),
    ("audio_audit_pro", "au_illegal",  "au_illegal_general",   "语音违法违规",   "语音中违法违规表述",          60.0, 85.0, "高风险"),
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
        for item_code, (name_cn, aliases) in items.items():
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
            else:
                db.add(
                    AuditItem(
                        package_code=package_code,
                        code=item_code,
                        name_cn=name_cn,
                        aliases=aliases,
                        sort_order=0,
                        is_enabled=True,
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
            row.description = scope_text
            row.scope_text = scope_text
            row.medium_threshold = medium
            row.high_threshold = high
            row.risk_level = risk_enum
            row.is_enabled = True
        else:
            db.add(
                AuditPoint(
                    package_code=package_code,
                    item_id=item_id,
                    code=point_code,
                    label=point_code,
                    label_cn=label_cn,
                    description=scope_text,
                    scope_text=scope_text,
                    medium_threshold=medium,
                    high_threshold=high,
                    risk_level=risk_enum,
                    is_enabled=True,
                    sort_order=0,
                )
            )
            created += 1
    if created > 0:
        await db.flush()
    return created


async def _purge_orphan_audit_data(db: AsyncSession) -> tuple[int, int]:
    """Delete audit_items / audit_points not in DEFAULT_AUDIT_ITEMS / DEFAULT_AUDIT_POINTS.

    Keeps audit_items that match a DEFAULT_AUDIT_ITEMS key (package, code)
    and audit_points that match a DEFAULT_AUDIT_POINTS key (package, code).
    Anything extra is from a previous schema and is removed.
    """
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


async def main() -> None:
    async with SessionLocal() as db:
        await _upsert_templates(db)
        await _upsert_default_strategy(db)
        await _upsert_categories(db)
        await db.flush()
        await _upsert_services(db)
        await db.flush()
        await _purge_removed_services(db)
        await db.flush()
        await _upsert_wordsets(db)
        await _upsert_detection_rules(db)
        await db.flush()
        items_created = await _upsert_audit_items(db)
        points_created = await _upsert_audit_points(db)
        items_purged, points_purged = await _purge_orphan_audit_data(db)
        await _upsert_human_review_configs(db)
        await _upsert_tags(db)
        await _upsert_user(db, "admin@adreview.example.com", "系统管理员", UserRole.ADMIN, settings.app_secret + "-admin")
        await _upsert_user(db, "reviewer@adreview.example.com", "审核员 Alice", UserRole.REVIEWER, "reviewer123")
        await _upsert_user(db, "mlr@adreview.example.com", "MLR 专家 Bob", UserRole.MLR, "mlr12345")
        await _upsert_user(db, "submitter@adreview.example.com", "提交者 Carol", UserRole.SUBMITTER, "submitter123")
        await db.commit()
        print(
            f"seed complete. audit_items={items_created} created (orphans purged={items_purged}) "
            f"audit_points={points_created} created (orphans purged={points_purged})"
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
                source=TagSource.PLATFORM,
                status=TagStatus.ACTIVE,
                version=1,
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
    await_engine = engine
    asyncio.run(await_engine.dispose())
