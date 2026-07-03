"""DetectionRule routes: nested under /services/{service_code}/rules.

HumanReviewConfig lives under a sibling router /services/{service_code}/human-review
to avoid path conflicts with the catch-all /rules/{label}.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.detection_rule import DetectionRule
from app.models.human_review_config import HumanReviewConfig, RiskLevel
from app.models.service import Service
from app.models.user import User
from app.models.workflow import WorkflowTemplate
from app.models.wordset import WordSet
from app.schemas.detection_rule import DetectionRuleOut, DetectionRuleResetResult, DetectionRuleUpdate
from app.schemas.human_review_config import HumanReviewConfigOut, HumanReviewConfigUpdate


class RuleCopyRequest(BaseModel):
    source_service_code: str

router = APIRouter(prefix="/services/{service_code}/rules", tags=["detection-rules"])
hr_router = APIRouter(prefix="/services/{service_code}", tags=["human-review"])


async def _ensure_service(db: AsyncSession, code: str) -> Service:
    svc = await db.scalar(select(Service).where(Service.code == code))
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="服务不存在")
    return svc


@router.get("", response_model=list[DetectionRuleOut])
async def list_rules(
    service_code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[DetectionRuleOut]:
    await _ensure_service(db, service_code)
    result = await db.execute(
        select(DetectionRule)
        .where(DetectionRule.service_code == service_code)
        .order_by(DetectionRule.id.asc())
    )
    return [DetectionRuleOut.model_validate(r) for r in result.scalars()]


@router.get("/wordsets", response_model=list[dict])
async def list_available_wordsets(
    service_code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[dict]:
    await _ensure_service(db, service_code)
    result = await db.execute(
        select(WordSet).where(WordSet.is_active.is_(True)).order_by(WordSet.id.asc())
    )
    return [
        {"id": w.id, "code": w.code, "name": w.name, "kind": w.kind.value if hasattr(w.kind, "value") else w.kind}
        for w in result.scalars()
    ]


@router.put("/{label}", response_model=DetectionRuleOut)
async def update_rule(
    service_code: str,
    label: str,
    body: DetectionRuleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DetectionRuleOut:
    await _ensure_service(db, service_code)
    rule = await db.scalar(
        select(DetectionRule).where(
            DetectionRule.service_code == service_code,
            DetectionRule.label == label,
        )
    )
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则不存在")

    new_med = body.medium_threshold if body.medium_threshold is not None else rule.medium_threshold
    new_high = body.high_threshold if body.high_threshold is not None else rule.high_threshold
    if new_med >= new_high:
        raise HTTPException(status_code=400, detail="中风险分必须 < 高风险分")

    if body.medium_threshold is not None:
        rule.medium_threshold = body.medium_threshold
    if body.high_threshold is not None:
        rule.high_threshold = body.high_threshold
    if body.scope_text is not None:
        rule.scope_text = body.scope_text
    if body.is_enabled is not None:
        rule.is_enabled = body.is_enabled
    if body.custom_wordset_id is not None:
        ws = await db.get(WordSet, body.custom_wordset_id)
        if not ws:
            raise HTTPException(status_code=400, detail="自定义词库不存在")
        rule.custom_wordset_id = body.custom_wordset_id

    await db.flush()
    await db.refresh(rule)
    await db.commit()
    return DetectionRuleOut.model_validate(rule)


@router.post("/reset", response_model=DetectionRuleResetResult)
async def reset_rules(
    service_code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DetectionRuleResetResult:
    """恢复默认分值：重置 medium/high 阈值到 seed 默认值。"""
    await _ensure_service(db, service_code)
    result = await db.execute(
        select(DetectionRule)
        .where(DetectionRule.service_code == service_code)
        .order_by(DetectionRule.id.asc())
    )
    rules = list(result.scalars())
    for rule in rules:
        defaults = _DEFAULT_THRESHOLDS.get(rule.label)
        if defaults:
            rule.medium_threshold = defaults[0]
            rule.high_threshold = defaults[1]
    await db.flush()
    await db.commit()
    for rule in rules:
        await db.refresh(rule)
    items = [DetectionRuleOut.model_validate(r) for r in rules]
    return DetectionRuleResetResult(items=items)


@router.post("/copy-from", response_model=list[DetectionRuleOut])
async def copy_rules_from_service(
    service_code: str,
    body: RuleCopyRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[DetectionRuleOut]:
    await _ensure_service(db, service_code)
    src_svc = await db.scalar(select(Service).where(Service.code == body.source_service_code))
    if not src_svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="源服务不存在")

    src_result = await db.execute(
        select(DetectionRule)
        .where(DetectionRule.service_code == body.source_service_code)
        .order_by(DetectionRule.id.asc())
    )
    src_rules = list(src_result.scalars())
    if not src_rules:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="源服务无检测规则可复制")

    dst_result = await db.execute(
        select(DetectionRule)
        .where(DetectionRule.service_code == service_code)
        .order_by(DetectionRule.id.asc())
    )
    dst_rules = list(dst_result.scalars())
    dst_by_label = {r.label: r for r in dst_rules}

    for src_rule in src_rules:
        if src_rule.label in dst_by_label:
            dst_rule = dst_by_label[src_rule.label]
            dst_rule.medium_threshold = src_rule.medium_threshold
            dst_rule.high_threshold = src_rule.high_threshold
            dst_rule.scope_text = src_rule.scope_text
            dst_rule.is_enabled = src_rule.is_enabled
            dst_rule.custom_wordset_id = src_rule.custom_wordset_id
        else:
            new_rule = DetectionRule(
                service_code=service_code,
                label=src_rule.label,
                label_cn=src_rule.label_cn,
                description=src_rule.description,
                medium_threshold=src_rule.medium_threshold,
                high_threshold=src_rule.high_threshold,
                scope_text=src_rule.scope_text,
                is_enabled=src_rule.is_enabled,
                custom_wordset_id=src_rule.custom_wordset_id,
            )
            db.add(new_rule)

    await db.flush()
    final_result = await db.execute(
        select(DetectionRule)
        .where(DetectionRule.service_code == service_code)
        .order_by(DetectionRule.id.asc())
    )
    items = [DetectionRuleOut.model_validate(r) for r in final_result.scalars()]
    await db.commit()
    return items


# Hardcoded seed defaults — must match scripts/seed.py DEFAULT_DETECTION_RULES
_DEFAULT_THRESHOLDS: dict[str, tuple[float, float]] = {
    "pt_logotoSocialNetwork": (50.0, 80.0),
    "pt_qrCode": (50.0, 80.0),
    "pt_programCode": (50.0, 80.0),
    "pt_toDirectContact_tii": (60.0, 90.0),
    "pt_toSocialNetwork_tii": (60.0, 90.0),
    "pt_toShortVideos_tii": (60.0, 90.0),
    "pt_investment_tii": (60.0, 90.0),
    "pt_recruitment_tii": (60.0, 90.0),
    "pt_certificate_tii": (60.0, 90.0),
}


def _hr_out(cfg: HumanReviewConfig) -> HumanReviewConfigOut:
    levels = []
    for name in (cfg.risk_levels or "").split(","):
        name = name.strip()
        if not name:
            continue
        try:
            levels.append(RiskLevel(name))
        except ValueError:
            continue
    return HumanReviewConfigOut.model_validate(
        {
            "id": cfg.id,
            "service_code": cfg.service_code,
            "is_enabled": cfg.is_enabled,
            "risk_levels": levels,
            "review_rule_id": cfg.review_rule_id,
            "notify_plan_id": cfg.notify_plan_id,
            "created_at": cfg.created_at,
            "updated_at": cfg.updated_at,
        }
    )


async def _get_or_create_hr(db: AsyncSession, service_code: str) -> HumanReviewConfig:
    cfg = await db.scalar(
        select(HumanReviewConfig).where(HumanReviewConfig.service_code == service_code)
    )
    if cfg:
        return cfg
    cfg = HumanReviewConfig(service_code=service_code)
    db.add(cfg)
    await db.flush()
    await db.refresh(cfg)
    await db.commit()
    return cfg


@hr_router.get("/human-review", response_model=HumanReviewConfigOut)
async def get_human_review(
    service_code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> HumanReviewConfigOut:
    await _ensure_service(db, service_code)
    cfg = await _get_or_create_hr(db, service_code)
    return _hr_out(cfg)


@hr_router.put("/human-review", response_model=HumanReviewConfigOut)
async def update_human_review(
    service_code: str,
    body: HumanReviewConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> HumanReviewConfigOut:
    await _ensure_service(db, service_code)
    cfg = await _get_or_create_hr(db, service_code)
    if body.is_enabled is not None:
        cfg.is_enabled = body.is_enabled
    if body.risk_levels is not None:
        cfg.risk_levels = ",".join(r.value for r in body.risk_levels)
    if body.review_rule_id is not None:
        wt = await db.get(WorkflowTemplate, body.review_rule_id)
        if not wt:
            raise HTTPException(status_code=400, detail="审核规则不存在")
        cfg.review_rule_id = body.review_rule_id
    if body.notify_plan_id is not None:
        cfg.notify_plan_id = body.notify_plan_id
    await db.flush()
    await db.refresh(cfg)
    await db.commit()
    return _hr_out(cfg)
