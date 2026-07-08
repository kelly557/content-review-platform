"""Strategy router: list/create/update/delete/duplicate/validate.

Default strategy (scope='default') is a singleton; its code/name/scope are
immutable and it cannot be deleted or duplicated.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.models.strategy import Strategy, StrategyScope
from app.models.strategy_item import StrategyItem
from app.models.strategy_point import StrategyPoint
from app.models.user import User
from app.models.detection_rule import DetectionRule
from app.models.workflow import WorkflowTemplate
from app.schemas.common import Page
from app.schemas.strategy import (
    HumanReviewSettings,
    StrategyCreate,
    StrategyDuplicateRequest,
    StrategyItemRef,
    StrategyOut,
    StrategyPointRef,
    StrategyUpdate,
    StrategyValidateResult,
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


def _merge_human_review(definition: dict, hr: HumanReviewSettings) -> dict:
    """把 HumanReviewSettings 写入 definition.human_review 键。"""
    merged = dict(definition or {})
    merged["human_review"] = hr.normalized().model_dump()
    return merged


async def _validate_review_rule(db: AsyncSession, review_rule_id: int | None) -> None:
    """校验 review_rule_id 存在且 code 以 hr_ 开头。"""
    if review_rule_id is None:
        return
    template = await db.get(WorkflowTemplate, review_rule_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"人工复审模板不存在 (id={review_rule_id})",
        )
    if not (template.code or "").startswith("hr_"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="人工复审模板必须以 hr_ 开头",
        )


async def _serialize_strategy(db: AsyncSession, strategy: Strategy) -> StrategyOut:
    """Eagerly materialize a Strategy into StrategyOut inside the async session.

    在 commit 之后构造 schema，避免响应序列化阶段触发
    `MissingGreenlet`（访问 server_default 列 / 时间戳字段会触发 lazy IO）。

    额外把 `enabled_points` 聚合摘要写入 `strategy.definition.enabled_points_meta`，
    避免列表场景下每次都要 N+1 解析所有 point 行。
    """
    await db.refresh(strategy)
    enabled = await _load_enabled_items(db, strategy.id)
    enabled_points = await _load_enabled_points(db, strategy.id)
    # JSONB 兜底：聚合摘要写到 definition 里
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
    data = {
        "id": strategy.id,
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
    """Load persisted strategy → point selections. Returns [] on any failure."""
    try:
        rows = await db.execute(
            select(StrategyPoint).where(StrategyPoint.strategy_id == strategy_id)
        )
    except Exception:
        return []
    out: list[StrategyPointRef] = []
    for r in rows.scalars():
        out.append(
            StrategyPointRef(
                media_type=r.media_type,
                item_id=r.item_id,
                point_id=r.point_id,
                is_enabled=r.is_enabled,
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

    hr_settings = HumanReviewSettings.model_validate(
        (body.definition or {}).get("human_review") or {}
    )
    await _validate_review_rule(db, hr_settings.review_rule_id)

    merged_definition = _merge_human_review(body.definition or {}, hr_settings)
    merged_definition["services"] = list(body.services or [])

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
            "human_review_enabled": hr_settings.is_enabled,
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
    if body.definition is not None and not is_default:
        hr_settings = HumanReviewSettings.model_validate(
            (body.definition or {}).get("human_review") or {}
        )
        await _validate_review_rule(db, hr_settings.review_rule_id)
        strategy.definition = _merge_human_review(body.definition or {}, hr_settings)
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


@router.delete("/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT)
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
    dup = Strategy(
        code=new_code,
        name=new_name,
        scope=src.scope,
        description=src.description,
        is_active=False,
        effective_from=src.effective_from,
        effective_until=src.effective_until,
        definition=src.definition or {},
        service_config=src.service_config or {},
        created_by_id=user.id,
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