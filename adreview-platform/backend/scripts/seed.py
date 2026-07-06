"""Seed initial data: roles represented via users + default workflow templates + default strategy + service catalog."""
import asyncio

from sqlalchemy import select
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
    {"code": "chat_detection_pro", "name": "私聊互动内容检测_专业版", "scope": ServiceScope.BUSINESS, "is_active": True, "category_code": "business"},
    {"code": "ad_compliance_detection_pro", "name": "广告法合规检测_专业版", "scope": ServiceScope.SPECIAL, "is_active": False, "category_code": "special"},
    {"code": "text_audit_pro", "name": "文本审核_专业版", "scope": ServiceScope.BUSINESS, "is_active": True, "category_code": "business"},
    {"code": "general_content_audit", "name": "通用内容审核", "scope": ServiceScope.GENERAL, "is_active": True, "category_code": "general"},
    {"code": "llm_query_moderation", "name": "大语言模型输入文字检测", "scope": ServiceScope.AIGC, "is_active": False, "category_code": "aigc"},
    {"code": "llm_response_moderation", "name": "大语言模型生成文字检测", "scope": ServiceScope.AIGC, "is_active": False, "category_code": "aigc"},
    {"code": "ai_art_detection", "name": "AIGC英文检测", "scope": ServiceScope.AIGC, "is_active": False, "category_code": "aigc"},
    {"code": "text_aigc_detector", "name": "AI生成文本鉴别", "scope": ServiceScope.AIGC, "is_active": False, "category_code": "aigc"},
    {"code": "comment_detection", "name": "公聊评论内容检测", "scope": ServiceScope.BUSINESS, "is_active": False, "category_code": "business"},
    {"code": "nickname_detection", "name": "用户昵称检测", "scope": ServiceScope.BUSINESS, "is_active": False, "category_code": "business"},
    {"code": "chat_detection", "name": "私聊互动内容检测", "scope": ServiceScope.BUSINESS, "is_active": False, "category_code": "business"},
    {"code": "ad_compliance_detection", "name": "广告法合规检测", "scope": ServiceScope.SPECIAL, "is_active": False, "category_code": "special"},
    {"code": "comment_multilingual_pro", "name": "国际业务多语言检测", "scope": ServiceScope.SPECIAL, "is_active": False, "category_code": "special"},
    {"code": "pgc_detection", "name": "PGC通用物料检测", "scope": ServiceScope.SPECIAL, "is_active": False, "category_code": "special"},
    {"code": "bailian_query_check", "name": "百炼文字输入检测", "scope": ServiceScope.BAILIAN, "is_active": False, "category_code": "bailian"},
    {"code": "bailian_response_check", "name": "百炼文字输出检测", "scope": ServiceScope.BAILIAN, "is_active": False, "category_code": "bailian"},
]


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


async def main() -> None:
    async with SessionLocal() as db:
        await _upsert_templates(db)
        await _upsert_default_strategy(db)
        await _upsert_categories(db)
        await db.flush()
        await _upsert_services(db)
        await db.flush()
        await _upsert_wordsets(db)
        await _upsert_detection_rules(db)
        await _upsert_human_review_configs(db)
        await _upsert_tags(db)
        await _upsert_user(db, "admin@adreview.example.com", "系统管理员", UserRole.ADMIN, settings.app_secret + "-admin")
        await _upsert_user(db, "reviewer@adreview.example.com", "审核员 Alice", UserRole.REVIEWER, "reviewer123")
        await _upsert_user(db, "mlr@adreview.example.com", "MLR 专家 Bob", UserRole.MLR, "mlr12345")
        await _upsert_user(db, "submitter@adreview.example.com", "提交者 Carol", UserRole.SUBMITTER, "submitter123")
        await db.commit()
        print("seed complete.")


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
