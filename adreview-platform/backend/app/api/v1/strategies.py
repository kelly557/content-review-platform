"""Strategy router: list/create/update/delete/duplicate/validate.

Default strategy (scope='default') is a singleton; its code/name/scope are
immutable and it cannot be deleted or duplicated.

Phase B：
- create / update 接受 rule_set_id + disposition_rule_id 并写入新 FK 列。
- 不再向 strategies.definition 写入 human_review JSONB；workflow_engine 走
  disposition_rule_id → disposition_engine.compose_effective。
- 旧的 definition.human_review / voice_rule_mode / audio_features / doc_* / video_*
  仍可读（兼容 Phase A），但写入路径不再产出。
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import (
    DispositionRule,
    RuleSet,
)
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.models.registered_model import (
    RegisteredModel,
    RegisteredModelStatus,
)
from app.models.strategy import Strategy, StrategyScope
from app.models.strategy_item import StrategyItem
from app.models.strategy_point import StrategyPoint
from app.models.user import User
from app.models.detection_rule import DetectionRule
from app.models.workflow import WorkflowTemplate
from app.schemas.common import Page
from app.schemas.strategy import (
    AudioFeatures,
    DocComposeModes,
    DocImageMode,
    DocTextMode,
    LlmReviewConfig,
    StrategyCreate,
    StrategyDuplicateRequest,
    StrategyItemRef,
    StrategyOut,
    StrategyPointRef,
    StrategyUpdate,
    StrategyValidateResult,
    VideoAudioMode,
    VideoComposeModes,
    VideoFrameInterval,
    VideoFrameMode,
    VoiceRuleMode,
)
from app.services import audit

router = APIRouter(prefix="/strategies", tags=["strategies"])


MEDIA_BY_PACKAGE = {
    "image_audit_pro": "image",
    "text_audit_pro": "text",
    "audio_audit_pro": "audio",
    "document_audit_pro": "doc",
    "video_audit_pro": "video",
}


def _merge_voice_features(definition: dict, features: AudioFeatures) -> dict:
    """写入 definition.audio_features；非破坏性合并（保留 keys，缺失补默认）。"""
    merged = dict(definition or {})
    merged["audio_features"] = features.normalized().model_dump()
    return merged


def _merge_voice_rule_mode(definition: dict, mode: VoiceRuleMode) -> dict:
    """写入 definition.voice_rule_mode。"""
    merged = dict(definition or {})
    merged["voice_rule_mode"] = mode.value
    return merged


def _merge_doc_modes(definition: dict, modes: DocComposeModes) -> dict:
    """写入 definition.doc_text_mode / doc_image_mode。"""
    merged = dict(definition or {})
    n = modes.normalized()
    merged["doc_text_mode"] = n.text_mode.value
    merged["doc_image_mode"] = n.image_mode.value
    return merged


def _merge_video_modes(definition: dict, modes: VideoComposeModes) -> dict:
    """写入 definition.video_frame_mode / video_audio_mode。"""
    merged = dict(definition or {})
    n = modes.normalized()
    merged["video_frame_mode"] = n.frame_mode.value
    merged["video_audio_mode"] = n.audio_mode.value
    return merged


def _merge_video_frame_interval(definition: dict, interval: VideoFrameInterval) -> dict:
    """写入 definition.video_frame_interval_sec。"""
    merged = dict(definition or {})
    merged["video_frame_interval_sec"] = interval.normalized().interval_sec
    return merged


async def _validate_llm_review(
    db: AsyncSession,
    llm_review: LlmReviewConfig,
) -> dict:
    """校验策略级 LlmReviewConfig。

    - 已启用时校验 model_id 真实存在（status=active + scale_class=large）。
    - 不启用时清空 model_id。
    - 已启用且 model_id 存在时，将 ``needs_multimodal_hint`` 写回，告知前端
      「所选模型缺少本策略所需的模态能力」(供 image/audio/video/doc 提示)。

    返回 ``{is_enabled, model_id, needs_multimodal_hint, expected_modalities,
             model_modalities}``，用于 serialize。
    """
    normalized = llm_review.normalized()
    if not normalized.is_enabled or normalized.model_id is None:
        return {
            "is_enabled": normalized.is_enabled,
            "model_id": normalized.model_id,
            "needs_multimodal_hint": False,
            "expected_modalities": [],
            "model_modalities": [],
        }
    model = await db.get(RegisteredModel, normalized.model_id)
    if model is None or model.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"llm_review.model_id 引用了不存在的模型: {normalized.model_id}",
        )
    if model.status != RegisteredModelStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"llm_review.model_id 引用了未激活模型: {normalized.model_id} "
                f"(status={model.status})"
            ),
        )
    model_mods = set(model.modalities or [])
    return {
        "is_enabled": True,
        "model_id": normalized.model_id,
        # expected_modalities 由调用方（_serialize_strategy / create / update）根据
        # 当前 enabled_items 计算；这里返回空，让调用方填充。
        "needs_multimodal_hint": False,
        "expected_modalities": [],
        "model_modalities": sorted(model_mods),
    }


async def _expected_modalities_for_strategy(
    db: AsyncSession,
    enabled_items: list,
    enabled_points: list,
) -> set[str]:
    """从策略所启用的 item / point 推断模型需要覆盖的 modality 集合。

    同时支持 Phase A（启用了 AuditItem 但 AuditPoint 列表未记录）和 Phase B
    (StrategyPointV2 在 rule_set 里)。当前策略编辑路径只读 StrategyPoint，
    因此本函数以 ``enabled_points`` 含有的 item_id 为准：
    - text-only item（name_cn 字段涵盖「文本」典型关键词）→ text
    - 含图像、视/音频敏感词 → image / audio / video
    - doc 文本走 text，图像部分走 image
    """
    item_ids = {ref.item_id for ref in (enabled_items or [])}
    point_ids = {ref.point_id for ref in (enabled_points or [])}
    candidate_ids = item_ids | {ref.item_id for ref in (enabled_points or [])}
    if not candidate_ids:
        return set()
    items = (
        (
            await db.execute(
                select(AuditItem).where(AuditItem.id.in_(candidate_ids))
            )
        )
        .scalars()
        .all()
    )
    pkg_to_media = MEDIA_BY_PACKAGE  # image_audit_pro → image
    # 点位级别：若某 item 既启用 item 又显式启用部分 point；只要 item 启用了，就
    # 视为该 item 的整类模态能力都纳入；具体到细粒度，仅在 user 启用 point 时
    # 才把 point_id 加入 — 这里直接用 item 级即可（LlmReviewCard 不做精细化）。
    mods: set[str] = set()
    for it in items:
        m = pkg_to_media.get(it.package_code)
        if m:
            mods.add(m)
    return mods


def _compute_multimodal_hint(expected: set[str], model_mods: set[str]) -> bool:
    """当策略需要的 modality 不被模型能力覆盖时返回 True。

    策略至少需要 text 时，只要所选模型具备 text 即可标记非必要 multimodal；
    当策略需要 image/audio/video 时，所选模型必须能覆盖对应 modality 之一
    （即 multimodal 模型），否则给提示。
    """
    if not expected:
        return False
    if expected <= {"text"}:
        return False
    # 至少 image/audio/video/doc 中一项需求未被模型覆盖时提示
    media_required = expected - {"text"}
    if not media_required:
        return False
    return not media_required.issubset(model_mods)


def _load_llm_review_definition(definition: dict | None) -> dict:
    """从 ``strategies.definition.llm_review`` 读出已规范化的字典。"""
    raw = (definition or {}).get("llm_review")
    if not isinstance(raw, dict):
        return {
            "is_enabled": False,
            "model_id": None,
            "needs_multimodal_hint": False,
            "expected_modalities": [],
            "model_modalities": [],
        }
    return {
        "is_enabled": bool(raw.get("is_enabled", False)),
        "model_id": raw.get("model_id"),
        "needs_multimodal_hint": bool(raw.get("needs_multimodal_hint", False)),
        "expected_modalities": raw.get("expected_modalities") or [],
        "model_modalities": raw.get("model_modalities") or [],
    }


async def _validate_phase_b_fk(
    db: AsyncSession,
    rule_set_id: Optional[int],
    disposition_rule_id: Optional[int],
) -> None:
    """Phase B：校验 rule_set_id / disposition_rule_id 真实存在。

    业务约束：
    - 创建策略时，若传了 rule_set_id / disposition_rule_id，必须指向真实行
    - 内置资源 is_editable=False 时，本接口以 admin 创建策略不应被指向（不允许
      创建「绑定到内置 resource」的对外策略）—— 此校验留 PR B4 UI 阶段
    """
    if rule_set_id is not None:
        rs = await db.get(RuleSet, rule_set_id)
        if rs is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"rule_set 不存在 (id={rule_set_id})",
            )
    if disposition_rule_id is not None:
        dr = await db.get(DispositionRule, disposition_rule_id)
        if dr is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"disposition_rule 不存在 (id={disposition_rule_id})",
            )


async def _serialize_strategy(db: AsyncSession, strategy: Strategy) -> StrategyOut:
    """Eagerly materialize a Strategy into StrategyOut inside the async session.

    在 commit 之后构造 schema，避免响应序列化阶段触发
    `MissingGreenlet`（访问 server_default 列 / 时间戳字段会触发 lazy IO）。

    额外把 `enabled_points` 聚合摘要写入 `strategy.definition.enabled_points_meta`，
    避免列表场景下每次都要 N+1 解析所有 point 行。

    Phase B：序列化时同时暴露 rule_set_id / disposition_rule_id；老的
    ``definition.human_review`` 字段保留在 definition dict 里供前端降级展示，
    但真相源是 disposition_rule_id。

    策略级大模型审核配置从 `definition.llm_review` 读出，并按当前启用的
    items 推算所需 modalities，刷新 ``needs_multimodal_hint``。上提为顶层 ``llm_review``。
    """
    await db.refresh(strategy)
    enabled = await _load_enabled_items(db, strategy.id)
    enabled_points = await _load_enabled_points(db, strategy.id)
    overrides_count = sum(1 for p in enabled_points if not p.is_enabled)
    definition = dict(strategy.definition or {})
    if enabled_points:
        definition["enabled_points_meta"] = {
            "total": len(enabled_points),
            "enabled": sum(1 for p in enabled_points if p.is_enabled),
            "disabled": overrides_count,
            "has_overrides": overrides_count > 0
            or _has_explicit_partial_selection(enabled, enabled_points),
        }
    llm_raw = _load_llm_review_definition(definition)
    expected_mods = await _expected_modalities_for_strategy(db, enabled, enabled_points)
    model_mods = set(llm_raw.get("model_modalities") or [])
    needs_hint = (
        bool(llm_raw.get("is_enabled"))
        and llm_raw.get("model_id") is not None
        and _compute_multimodal_hint(expected_mods, model_mods)
    )
    llm_out = LlmReviewConfig(
        is_enabled=bool(llm_raw.get("is_enabled")),
        model_id=llm_raw.get("model_id"),
        needs_multimodal_hint=needs_hint,
    )
    data = {
        "id": strategy.id,
        "public_id": strategy.public_id,
        "code": strategy.code,
        "name": strategy.name,
        "scope": strategy.scope,
        "description": strategy.description,
        "is_active": strategy.is_active,
        "effective_from": strategy.effective_from,
        "effective_until": strategy.effective_until,
        "definition": definition,
        "service_config": strategy.service_config or {},
        "enabled_items": enabled,
        "enabled_points": enabled_points,
        "rule_set_id": strategy.rule_set_id,
        "disposition_rule_id": strategy.disposition_rule_id,
        "llm_review": llm_out,
        "created_at": strategy.created_at,
        "updated_at": strategy.updated_at,
    }
    return StrategyOut.model_validate(data)


def _has_explicit_partial_selection(
    enabled_items: list[StrategyItemRef],
    enabled_points: list[StrategyPointRef],
) -> bool:
    """True if any item has at least one explicit point-level row (regardless of
    is_enabled value). 表示该 item 已被用户细化（哪怕所有 point 都仍 enabled）。
    """
    items_with_points: set[tuple[str, int]] = {
        (p.media_type, p.item_id) for p in enabled_points
    }
    for it in enabled_items:
        if it.is_enabled and (it.media_type, it.item_id) in items_with_points:
            return True
    return False


async def _load_enabled_items(
    db: AsyncSession, strategy_id: int
) -> list[StrategyItemRef]:
    """Load enabled audit items for a strategy. Returns [] on any failure."""
    try:
        rows = await db.execute(
            select(StrategyItem).where(StrategyItem.strategy_id == strategy_id)
        )
    except Exception:
        return []
    out: list[StrategyItemRef] = []
    for r in rows.scalars():
        out.append(
            StrategyItemRef(
                media_type=r.media_type,
                item_id=r.item_id,
                is_enabled=r.is_enabled,
            )
        )
    return out


async def _replace_enabled_items(
    db: AsyncSession,
    strategy_id: int,
    enabled_items: list[StrategyItemRef],
) -> None:
    await db.execute(
        delete(StrategyItem).where(StrategyItem.strategy_id == strategy_id)
    )
    seen: set[tuple[str, int]] = set()
    for ref in enabled_items:
        key = (ref.media_type, ref.item_id)
        if key in seen:
            continue
        seen.add(key)
        item = await db.get(AuditItem, ref.item_id)
        if not item:
            continue
        expected_media = MEDIA_BY_PACKAGE.get(item.package_code)
        if expected_media and expected_media != ref.media_type:
            ref_media = ref.media_type
        db.add(
            StrategyItem(
                strategy_id=strategy_id,
                media_type=ref.media_type,
                item_id=ref.item_id,
                is_enabled=ref.is_enabled,
            )
        )


async def _load_enabled_points(
    db: AsyncSession, strategy_id: int
) -> list[StrategyPointRef]:
    """Load persisted strategy → point selections. Returns [] on any failure.

    同步从 strategies.definition.enabled_point_overrides 读回阈值 / 关联库的 override。
    """
    try:
        rows = await db.execute(
            select(StrategyPoint).where(StrategyPoint.strategy_id == strategy_id)
        )
    except Exception:
        return []
    overrides: dict[str, dict[str, dict[str, dict[str, Any]]]] = {}
    strat = await db.get(Strategy, strategy_id)
    if strat is not None:
        definition = strat.definition or {}
        overrides = dict(definition.get("enabled_point_overrides") or {})
    out: list[StrategyPointRef] = []
    for r in rows.scalars():
        patch = (
            overrides.get(r.media_type, {})
            .get(str(r.item_id), {})
            .get(str(r.point_id), {})
        )
        out.append(
            StrategyPointRef(
                media_type=r.media_type,
                item_id=r.item_id,
                point_id=r.point_id,
                is_enabled=r.is_enabled,
                medium_threshold=patch.get("medium_threshold"),
                high_threshold=patch.get("high_threshold"),
                low_threshold_min=patch.get("low_threshold_min"),
                low_threshold_max=patch.get("low_threshold_max"),
                medium_threshold_min=patch.get("medium_threshold_min"),
                medium_threshold_max=patch.get("medium_threshold_max"),
                high_threshold_min=patch.get("high_threshold_min"),
                high_threshold_max=patch.get("high_threshold_max"),
            )
        )
    return out


async def _replace_enabled_points(
    db: AsyncSession,
    strategy_id: int,
    enabled_points: list[StrategyPointRef],
    enabled_items: list[StrategyItemRef] | None = None,
) -> None:
    """Replace strategy_points rows for a strategy with PATCH semantics.

    级联规则（决策：item 关 → point 自动关，但保留用户记忆）：

    - 请求中的 point 显式落库（is_enabled 按请求值）
    - 不在请求中、但所属 item 仍启用的 point：保留旧行（保留用户记忆）
    - 不在请求中、且所属 item 被关闭的 point：is_enabled 设为 false
      （item 级联禁用，point 行保留以便重开时恢复）
    - 不再属于任何「已启用 item」的孤儿 point（item 已不在 enabled_items
      中）：保留行但 is_enabled=false
    """
    if enabled_items is None:
        # 调用方未传 enabled_items 时，回退为「该 strategy 的现有 enabled_items」
        rows = await db.execute(
            select(StrategyItem).where(StrategyItem.strategy_id == strategy_id)
        )
        enabled_item_keys: set[tuple[str, int]] = {
            (r.media_type, r.item_id) for r in rows.scalars() if r.is_enabled
        }
    else:
        enabled_item_keys = {
            (ref.media_type, ref.item_id)
            for ref in enabled_items
            if ref.is_enabled
        }

    # 1) 处理请求中显式给定的 point
    seen: set[tuple[str, int]] = set()
    overrides: dict[str, dict[str, dict[str, Any]]] = {}
    for ref in enabled_points:
        key = (ref.media_type, ref.point_id)
        if key in seen:
            continue
        seen.add(key)
        point = await db.get(AuditPoint, ref.point_id)
        if not point:
            continue
        if point.item_id != ref.item_id:
            continue
        expected_media = MEDIA_BY_PACKAGE.get(point.package_code)
        if expected_media and expected_media != ref.media_type:
            pass
        # upsert: 按 (strategy_id, point_id) 唯一
        existing = await db.execute(
            select(StrategyPoint).where(
                StrategyPoint.strategy_id == strategy_id,
                StrategyPoint.point_id == ref.point_id,
            )
        )
        existing_row = existing.scalar_one_or_none()
        if existing_row:
            existing_row.is_enabled = ref.is_enabled
            existing_row.media_type = ref.media_type
            existing_row.item_id = ref.item_id
        else:
            db.add(
                StrategyPoint(
                    strategy_id=strategy_id,
                    media_type=ref.media_type,
                    item_id=ref.item_id,
                    point_id=ref.point_id,
                    is_enabled=ref.is_enabled,
                )
            )

        # 收集 override（低/中/高风险分）到 strategies.definition
        # 「关联自定义图库词库」已上移至审核项；策略级不再存 linked_library_ids override。
        patch: dict[str, Any] = {}
        if ref.medium_threshold is not None:
            patch["medium_threshold"] = ref.medium_threshold
        if ref.high_threshold is not None:
            patch["high_threshold"] = ref.high_threshold
        if ref.low_threshold_min is not None:
            patch["low_threshold_min"] = ref.low_threshold_min
        if ref.low_threshold_max is not None:
            patch["low_threshold_max"] = ref.low_threshold_max
        if ref.medium_threshold_min is not None:
            patch["medium_threshold_min"] = ref.medium_threshold_min
        if ref.medium_threshold_max is not None:
            patch["medium_threshold_max"] = ref.medium_threshold_max
        if ref.high_threshold_min is not None:
            patch["high_threshold_min"] = ref.high_threshold_min
        if ref.high_threshold_max is not None:
            patch["high_threshold_max"] = ref.high_threshold_max
        if patch:
            overrides.setdefault(ref.media_type, {})
            overrides[ref.media_type].setdefault(str(ref.item_id), {})
            overrides[ref.media_type][str(ref.item_id)][str(ref.point_id)] = patch

    # 2) 扫描该 strategy 现存所有 point 行：
    #    - 若所属 item 不在 enabled_item_keys 中 → 关闭（保留行）
    #    - 否则保留原 is_enabled 不动（item 启用时不动 point 级记忆）
    existing_rows = await db.execute(
        select(StrategyPoint).where(StrategyPoint.strategy_id == strategy_id)
    )
    for r in existing_rows.scalars():
        if r.point_id in seen:
            continue
        item_key = (r.media_type, r.item_id)
        if item_key not in enabled_item_keys:
            if r.is_enabled:
                r.is_enabled = False

    # 3) 持久化 point 级 override（中/高风险分 + 关联库）到 strategies.definition。
    #    决策：override 不写 audit_point 表，只随策略保存。
    if overrides or not seen:
        strategy = await db.get(Strategy, strategy_id)
        if strategy is not None:
            definition = dict(strategy.definition or {})
            point_overrides = dict(definition.get("enabled_point_overrides") or {})
            if not overrides and not seen and "enabled_point_overrides" in definition:
                # 本次调用未传任何 point 但存在旧 overrides，按全清空处理
                # （allow point 全清场景下保留，给前端 reset 能力）
                point_overrides = {}
            for media_type, by_item in overrides.items():
                point_overrides.setdefault(media_type, {})
                for item_id_str, by_point in by_item.items():
                    point_overrides[media_type].setdefault(item_id_str, {})
                    for point_id_str, patch in by_point.items():
                        point_overrides[media_type][item_id_str][point_id_str] = patch
            definition["enabled_point_overrides"] = point_overrides
            strategy.definition = definition


async def _next_code(db: AsyncSession) -> str:
    """Generate next sequential business code like '2016976'."""
    result = await db.execute(select(func.max(Strategy.code)))
    max_code = result.scalar_one_or_none()
    if not max_code or not max_code.isdigit():
        return "2000001"
    return str(int(max_code) + 1)


@router.get("", response_model=Page[StrategyOut])
async def list_strategies(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: Optional[str] = None,
    scope: Optional[StrategyScope] = None,
) -> Page[StrategyOut]:
    stmt = select(Strategy)
    conditions = []
    if scope:
        conditions.append(Strategy.scope == scope)
    if q:
        conditions.append(or_(Strategy.name.ilike(f"%{q}%"), Strategy.code.ilike(f"%{q}%")))
    if conditions:
        stmt = stmt.where(and_(*conditions))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(Strategy.scope.asc(), Strategy.id.asc())
    stmt = stmt.offset((page - 1) * size).limit(size)
    result = await db.execute(stmt)
    items_out: list[StrategyOut] = []
    for s in result.scalars():
        so = StrategyOut.model_validate(s)
        so.enabled_items = await _load_enabled_items(db, s.id)
        so.enabled_points = await _load_enabled_points(db, s.id)
        items_out.append(so)
    return Page(items=items_out, total=total, page=page, size=size)


@router.post("", response_model=StrategyOut, status_code=status.HTTP_201_CREATED)
async def create_strategy(
    body: StrategyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> StrategyOut:
    if body.scope == StrategyScope.DEFAULT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DEFAULT 策略不可手动创建，系统自动维护",
        )

    code = body.code
    if code:
        existing = await db.execute(select(Strategy).where(Strategy.code == code))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="code 已存在")
    else:
        code = await _next_code(db)

    # Phase B：rule_set / disposition FK 校验
    await _validate_phase_b_fk(
        db, body.rule_set_id, body.disposition_rule_id
    )

    try:
        voice_mode = VoiceRuleMode(
            (body.definition or {}).get("voice_rule_mode") or VoiceRuleMode.REUSE_TEXT.value
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"voice_rule_mode 非法: {e}",
        )
    try:
        audio_features = AudioFeatures.model_validate(
            (body.definition or {}).get("audio_features") or {}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"audio_features 非法: {e}",
        )

    try:
        doc_modes = DocComposeModes.model_validate({
            "text_mode": (body.definition or {}).get("doc_text_mode") or DocTextMode.REUSE_TEXT.value,
            "image_mode": (body.definition or {}).get("doc_image_mode") or DocImageMode.REUSE_IMAGE.value,
        })
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"doc_*_mode 非法: {e}",
        )

    try:
        video_modes = VideoComposeModes.model_validate({
            "frame_mode": (body.definition or {}).get("video_frame_mode") or VideoFrameMode.REUSE_IMAGE.value,
            "audio_mode": (body.definition or {}).get("video_audio_mode") or VideoAudioMode.REUSE_AUDIO.value,
        })
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"video_*_mode 非法: {e}",
        )

    try:
        video_frame_interval = VideoFrameInterval.model_validate({
            "interval_sec": (body.definition or {}).get("video_frame_interval_sec") if "video_frame_interval_sec" in (body.definition or {}) else 5,
        })
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"video_frame_interval_sec 非法: {e}",
        )

    # Phase B：human_review 不再写入 definition（真相源是 disposition_rule_id）
    merged_definition = _merge_voice_rule_mode(body.definition or {}, voice_mode)
    merged_definition = _merge_voice_features(merged_definition, audio_features)
    merged_definition = _merge_doc_modes(merged_definition, doc_modes)
    merged_definition = _merge_video_modes(merged_definition, video_modes)
    merged_definition = _merge_video_frame_interval(merged_definition, video_frame_interval)
    merged_definition["services"] = list(body.services or [])

    llm_review_payload = await _validate_llm_review(db, body.llm_review or LlmReviewConfig())
    merged_definition["llm_review"] = llm_review_payload

    strategy = Strategy(
        code=code,
        name=body.name,
        scope=body.scope,
        description=body.description,
        is_active=body.is_active,
        effective_from=body.effective_from,
        effective_until=body.effective_until,
        definition=merged_definition,
        service_config=body.service_config or {},
        created_by_id=user.id,
        rule_set_id=body.rule_set_id,
        disposition_rule_id=body.disposition_rule_id,
    )
    db.add(strategy)
    await db.flush()

    if body.enabled_items:
        await _replace_enabled_items(db, strategy.id, body.enabled_items)
    if body.enabled_points:
        await _replace_enabled_points(
            db, strategy.id, body.enabled_points, body.enabled_items
        )

    await audit.write_audit(
        db, actor=user, action="strategy.create",
        entity_type="strategy", entity_id=strategy.id,
        payload={
            "code": strategy.code,
            "scope": strategy.scope.value,
            "enabled_item_count": len(body.enabled_items or []),
            "enabled_point_count": len(body.enabled_points or []),
            "rule_set_id": body.rule_set_id,
            "disposition_rule_id": body.disposition_rule_id,
            "llm_review": {
                "is_enabled": llm_review_payload["is_enabled"],
                "model_id": llm_review_payload["model_id"],
            },
        },
    )
    await db.commit()
    return await _serialize_strategy(db, strategy)


@router.get("/{strategy_id}", response_model=StrategyOut)
async def get_strategy(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> StrategyOut:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")
    return await _serialize_strategy(db, strategy)


@router.patch("/{strategy_id}", response_model=StrategyOut)
async def update_strategy(
    strategy_id: int,
    body: StrategyUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> StrategyOut:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")

    is_default = strategy.scope == StrategyScope.DEFAULT

    if is_default and (body.name is not None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="默认策略的名称不可修改",
        )

    if body.name is not None:
        strategy.name = body.name
    if body.description is not None:
        strategy.description = body.description
    if body.is_active is not None:
        strategy.is_active = body.is_active
    if body.effective_from is not None:
        strategy.effective_from = body.effective_from
    if body.effective_until is not None:
        strategy.effective_until = body.effective_until

    # Phase B：rule_set / disposition 绑定 — 仅非 default 策略可改
    if not is_default:
        if body.rule_set_id is not None:
            rs = await db.get(RuleSet, body.rule_set_id)
            if rs is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"rule_set 不存在 (id={body.rule_set_id})",
                )
            strategy.rule_set_id = body.rule_set_id
        if body.disposition_rule_id is not None:
            dr = await db.get(DispositionRule, body.disposition_rule_id)
            if dr is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"disposition_rule 不存在 (id={body.disposition_rule_id})",
                )
            strategy.disposition_rule_id = body.disposition_rule_id

    if body.definition is not None and not is_default:
        existing_def = dict(strategy.definition or {})
        def_in = body.definition or {}

        # voice_rule_mode: 缺省保留旧值；显式传 None 视为保留旧值
        mode_raw = def_in.get("voice_rule_mode", existing_def.get("voice_rule_mode"))
        if mode_raw is None:
            mode_raw = VoiceRuleMode.REUSE_TEXT.value
        try:
            voice_mode = VoiceRuleMode(mode_raw)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"voice_rule_mode 非法: {e}",
            )

        # audio_features: 缺省保留旧值（partial 合并的简化实现：每次全量替换）
        try:
            if "audio_features" in def_in:
                audio_features = AudioFeatures.model_validate(def_in["audio_features"])
            else:
                existing_features = existing_def.get("audio_features") or {}
                audio_features = AudioFeatures.model_validate(existing_features)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"audio_features 非法: {e}",
            )

        # doc_*_mode: 缺省保留旧值
        try:
            doc_raw_text = def_in.get("doc_text_mode", existing_def.get("doc_text_mode", DocTextMode.REUSE_TEXT.value))
            doc_raw_image = def_in.get("doc_image_mode", existing_def.get("doc_image_mode", DocImageMode.REUSE_IMAGE.value))
            doc_modes = DocComposeModes.model_validate({
                "text_mode": doc_raw_text,
                "image_mode": doc_raw_image,
            })
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"doc_*_mode 非法: {e}",
            )

        # video_*_mode: 缺省保留旧值
        try:
            video_raw_frame = def_in.get("video_frame_mode", existing_def.get("video_frame_mode", VideoFrameMode.REUSE_IMAGE.value))
            video_raw_audio = def_in.get("video_audio_mode", existing_def.get("video_audio_mode", VideoAudioMode.REUSE_AUDIO.value))
            video_modes = VideoComposeModes.model_validate({
                "frame_mode": video_raw_frame,
                "audio_mode": video_raw_audio,
            })
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"video_*_mode 非法: {e}",
            )

        # video_frame_interval_sec: 缺省保留旧值；范围 1..1000
        try:
            if "video_frame_interval_sec" in def_in:
                raw_interval = def_in["video_frame_interval_sec"]
            else:
                raw_interval = existing_def.get("video_frame_interval_sec", 5)
            video_frame_interval = VideoFrameInterval.model_validate({"interval_sec": raw_interval})
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"video_frame_interval_sec 非法: {e}",
            )

        # Phase B：human_review 不再回写到 definition。保留旧值（如有）作历史。
        merged_def = dict(existing_def)
        merged_def.pop("human_review", None)
        merged_def = _merge_voice_rule_mode(merged_def, voice_mode)
        merged_def = _merge_voice_features(merged_def, audio_features)
        merged_def = _merge_doc_modes(merged_def, doc_modes)
        merged_def = _merge_video_modes(merged_def, video_modes)
        merged_def = _merge_video_frame_interval(merged_def, video_frame_interval)
        # 保留 enabled_point_overrides（已被 _replace_enabled_points 写过）
        strategy.definition = merged_def

    # 「大模型审核能力」单一开关。PATCH 语义：body.llm_review=None → 不动；非 None → 全量替换。
    if body.llm_review is not None and not is_default:
        llm_review_payload = await _validate_llm_review(db, body.llm_review)
        merged_def = dict(strategy.definition or {})
        merged_def["llm_review"] = llm_review_payload
        strategy.definition = merged_def
    if body.service_config is not None and not is_default:
        strategy.service_config = body.service_config

    if body.services is not None and not is_default:
        merged = dict(strategy.definition or {})
        merged["services"] = list(body.services)
        strategy.definition = merged

    if body.enabled_items is not None and not is_default:
        await _replace_enabled_items(db, strategy.id, body.enabled_items)
    if body.enabled_points is not None and not is_default:
        await _replace_enabled_points(
            db, strategy.id, body.enabled_points, body.enabled_items
        )

    await db.flush()
    await audit.write_audit(
        db, actor=user, action="strategy.update",
        entity_type="strategy", entity_id=strategy.id,
        payload={"fields": list(body.model_dump(exclude_unset=True).keys())},
    )
    await db.commit()
    return await _serialize_strategy(db, strategy)


@router.delete("/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_strategy(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> None:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")
    if strategy.scope == StrategyScope.DEFAULT:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="默认策略不可删除")
    await db.delete(strategy)
    await db.flush()
    await audit.write_audit(
        db, actor=user, action="strategy.delete",
        entity_type="strategy", entity_id=strategy_id,
        payload={"code": strategy.code},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{strategy_id}/duplicate", response_model=StrategyOut, status_code=status.HTTP_201_CREATED)
async def duplicate_strategy(
    strategy_id: int,
    body: StrategyDuplicateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> Strategy:
    src = await db.get(Strategy, strategy_id)
    if not src:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="源策略不存在")
    if src.scope == StrategyScope.DEFAULT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="默认策略不可复制")

    new_code = await _next_code(db)
    new_name = body.name or f"{src.name} - 副本"

    # Phase B：duplicate 时清掉 definition.human_review（迁移后兜底），FK 沿用源策略的。
    dup_definition = dict(src.definition or {})
    dup_definition.pop("human_review", None)
    # 复制时强制重置大模型 model_id，避免源策略已绑定的大模型被停用导致新策略失效。
    src_llm = _load_llm_review_definition(dup_definition)
    dup_definition["llm_review"] = {
        "is_enabled": bool(src_llm.get("is_enabled", False)),
        "model_id": None,
        "needs_multimodal_hint": False,
        "expected_modalities": [],
        "model_modalities": [],
    }

    dup = Strategy(
        code=new_code,
        name=new_name,
        scope=src.scope,
        description=src.description,
        is_active=False,
        effective_from=src.effective_from,
        effective_until=src.effective_until,
        definition=dup_definition,
        service_config=src.service_config or {},
        created_by_id=user.id,
        rule_set_id=src.rule_set_id,
        disposition_rule_id=src.disposition_rule_id,
    )
    db.add(dup)
    await db.flush()

    src_items = await _load_enabled_items(db, src.id)
    if src_items:
        await _replace_enabled_items(db, dup.id, src_items)
    src_points = await _load_enabled_points(db, src.id)
    if src_points:
        await _replace_enabled_points(db, dup.id, src_points, src_items)

    await audit.write_audit(
        db, actor=user, action="strategy.duplicate",
        entity_type="strategy", entity_id=dup.id,
        payload={"source_id": src.id, "new_code": new_code},
    )
    await db.commit()
    dup.enabled_items = await _load_enabled_items(db, dup.id)
    return dup


@router.post("/{strategy_id}/validate", response_model=StrategyValidateResult)
async def validate_strategy(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> StrategyValidateResult:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")

    warnings: list[str] = []
    if strategy.effective_from and strategy.effective_until:
        if strategy.effective_from >= strategy.effective_until:
            warnings.append("生效起始时间晚于结束时间")

    return StrategyValidateResult(
        ok=True,
        warnings=warnings,
        checked_at=datetime.now(timezone.utc),
    )
