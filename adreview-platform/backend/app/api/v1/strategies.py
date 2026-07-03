"""Strategy router: list/create/update/delete/duplicate/validate.

Default strategy (scope='default') is a singleton; its code/name/scope are
immutable and it cannot be deleted or duplicated.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.strategy import Strategy, StrategyScope
from app.models.user import User
from app.models.detection_rule import DetectionRule
from app.schemas.common import Page
from app.schemas.strategy import (
    StrategyCreate,
    StrategyDuplicateRequest,
    StrategyOut,
    StrategyUpdate,
    StrategyValidateResult,
    StrategyRuleConfigImport,
    ServiceRuleConfigSnapshot,
)
from app.services import audit

router = APIRouter(prefix="/strategies", tags=["strategies"])


def _ensure_code_unique_or_409(db: AsyncSession, code: str, exclude_id: Optional[int] = None) -> None:
    """Caller must `await` after constructing the query — kept sync to keep call-site simple."""
    raise NotImplementedError


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
    stmt = stmt.order_by(Strategy.scope.asc(), Strategy.priority.asc(), Strategy.id.asc())
    stmt = stmt.offset((page - 1) * size).limit(size)
    result = await db.execute(stmt)
    items = [StrategyOut.model_validate(s) for s in result.scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=StrategyOut, status_code=status.HTTP_201_CREATED)
async def create_strategy(
    body: StrategyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> Strategy:
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

    merged_definition = {
        **(body.definition or {}),
        "services": list(body.services or []),
    }

    strategy = Strategy(
        code=code,
        name=body.name,
        scope=body.scope,
        description=body.description,
        is_active=body.is_active,
        priority=body.priority,
        effective_from=body.effective_from,
        effective_until=body.effective_until,
        definition=merged_definition,
        service_config=body.service_config or {},
        created_by_id=user.id,
    )
    db.add(strategy)
    await db.flush()
    await audit.write_audit(
        db, actor=user, action="strategy.create",
        entity_type="strategy", entity_id=strategy.id,
        payload={"code": strategy.code, "scope": strategy.scope.value},
    )
    await db.commit()
    return strategy


@router.get("/{strategy_id}", response_model=StrategyOut)
async def get_strategy(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> Strategy:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")
    return strategy


@router.patch("/{strategy_id}", response_model=StrategyOut)
async def update_strategy(
    strategy_id: int,
    body: StrategyUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> Strategy:
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
    if body.priority is not None:
        strategy.priority = body.priority
    if body.effective_from is not None:
        strategy.effective_from = body.effective_from
    if body.effective_until is not None:
        strategy.effective_until = body.effective_until
    if body.definition is not None and not is_default:
        strategy.definition = body.definition
    if body.service_config is not None and not is_default:
        strategy.service_config = body.service_config

    if body.services is not None and not is_default:
        merged = dict(strategy.definition or {})
        merged["services"] = list(body.services)
        strategy.definition = merged

    await db.flush()
    await db.refresh(strategy)
    await audit.write_audit(
        db, actor=user, action="strategy.update",
        entity_type="strategy", entity_id=strategy.id,
        payload={"fields": list(body.model_dump(exclude_unset=True).keys())},
    )
    await db.commit()
    return strategy


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
        priority=src.priority,
        effective_from=src.effective_from,
        effective_until=src.effective_until,
        definition=src.definition or {},
        service_config=src.service_config or {},
        created_by_id=user.id,
    )
    db.add(dup)
    await db.flush()
    await audit.write_audit(
        db, actor=user, action="strategy.duplicate",
        entity_type="strategy", entity_id=dup.id,
        payload={"source_id": src.id, "new_code": new_code},
    )
    await db.commit()
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

    if strategy.scope != StrategyScope.DEFAULT:
        same_priority = await db.execute(
            select(Strategy).where(
                Strategy.priority == strategy.priority,
                Strategy.scope == StrategyScope.GENERAL,
                Strategy.id != strategy.id,
                Strategy.is_active.is_(True),
            )
        )
        peers = list(same_priority.scalars())
        if peers:
            warnings.append(f"同优先级 P{strategy.priority} 还有 {len(peers)} 个其他启用策略，可能产生匹配歧义")

    return StrategyValidateResult(
        ok=True,
        warnings=warnings,
        checked_at=datetime.now(timezone.utc),
    )


@router.get("/{strategy_id}/rule-config", response_model=list[ServiceRuleConfigSnapshot])
async def get_strategy_rule_config(
    strategy_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> list[ServiceRuleConfigSnapshot]:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")

    service_codes: list[str] = ((strategy.definition or {}).get("services") or [])
    svc_config: dict = strategy.service_config or {}
    result: list[ServiceRuleConfigSnapshot] = []

    for sc in service_codes:
        rules_result = await db.execute(
            select(DetectionRule).where(DetectionRule.service_code == sc).order_by(DetectionRule.id.asc())
        )
        rules = list(rules_result.scalars())

        overrides = svc_config.get(sc, {})
        rule_overrides_map = overrides.get("rule_overrides", {})
        sub_scopes = overrides.get("sub_scopes", [])

        if not sub_scopes and rules:
            sub_scopes = list({r.scope_text for r in rules if r.scope_text})

        result.append(ServiceRuleConfigSnapshot(
            service_code=sc,
            sub_scopes=sub_scopes,
            rule_overrides=rule_overrides_map,
        ))

    return result


@router.put("/{strategy_id}/rule-config", response_model=StrategyOut)
async def update_strategy_rule_config(
    strategy_id: int,
    body: list[ServiceRuleConfigSnapshot],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> Strategy:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")
    if strategy.scope == StrategyScope.DEFAULT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="默认策略不可配置审核范围")

    svc_config: dict = {}
    for snap in body:
        svc_config[snap.service_code] = {
            "sub_scopes": snap.sub_scopes,
            "rule_overrides": snap.rule_overrides,
        }
    strategy.service_config = svc_config
    await db.flush()
    await db.refresh(strategy)
    await audit.write_audit(
        db, actor=user, action="strategy.rule_config.update",
        entity_type="strategy", entity_id=strategy.id,
        payload={"service_count": len(svc_config)},
    )
    await db.commit()
    return strategy


@router.post("/{strategy_id}/rule-config/import", response_model=StrategyOut)
async def import_rule_config(
    strategy_id: int,
    body: StrategyRuleConfigImport,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin")),
) -> Strategy:
    strategy = await db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="策略不存在")
    if strategy.scope == StrategyScope.DEFAULT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="默认策略不可导入配置")

    src = await db.get(Strategy, body.source_strategy_id)
    if not src:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="源策略不存在")
    if src.scope == StrategyScope.DEFAULT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="默认策略的配置不可被导入")

    strategy.service_config = src.service_config or {}
    await db.flush()
    await db.refresh(strategy)
    await audit.write_audit(
        db, actor=user, action="strategy.rule_config.import",
        entity_type="strategy", entity_id=strategy.id,
        payload={"source_id": src.id},
    )
    await db.commit()
    return strategy