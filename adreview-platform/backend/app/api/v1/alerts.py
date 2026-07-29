"""Alert events router (异常分析 tab)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select, String as _String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.alert_event import AlertEvent
from app.models.material import Material
from app.models.review import ReviewTask
from app.models.user import User
from app.services.report_metrics import (
    AUDIT_MODALITIES,
    SUPPORTED_WINDOWS,
    _build_modality_exists,
    resolve_custom_window,
    resolve_window,
)
from app.schemas.alert import AlertAckRequest, AlertEventOut, AlertPage

router = APIRouter(prefix="/alerts", tags=["alerts"])


def _to_out(a: AlertEvent) -> AlertEventOut:
    return AlertEventOut(
        id=a.id,
        rule_code=a.rule_code,
        severity=a.severity,
        metric=a.metric,
        window_start=a.window_start,
        window_end=a.window_end,
        observed_value=a.observed_value,
        threshold=a.threshold,
        dimension=a.dimension or {},
        detail=a.detail or {},
        status=a.status,
        ack_by=a.ack_by,
        ack_at=a.ack_at,
        ack_note=a.ack_note,
        notified=bool(a.notified),
        created_at=a.created_at,
    )


def _resolve_optional_window(
    start: Optional[datetime], end: Optional[datetime], window: Optional[str]
):
    """Resolve ``[start, end]`` / ``window`` shorthand into a ``Window`` or None.

    Returns ``None`` to mean "no time filter"; raises ``HTTPException(400)``
    if the pair is malformed.
    """
    if start is None and end is None:
        if window is None:
            return None
        if window not in SUPPORTED_WINDOWS:
            raise HTTPException(status_code=400, detail=f"unsupported window: {window}")
        return resolve_window(window)
    if start is None or end is None:
        raise HTTPException(
            status_code=400, detail="start and end must be provided together"
        )
    try:
        return resolve_custom_window(start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _apply_alerts_filters(
    base: Select,
    *,
    status_: Optional[str],
    rule_code: Optional[str],
    win,
    modalities: Optional[List[str]],
    strategy_codes: Optional[List[str]],
    account_ids: Optional[List[str]],
    ips: Optional[List[str]],
    channels: Optional[List[str]],
    risk_label_paths: Optional[List[str]],
) -> Select:
    """Apply the time + 5-dimensional filters to a SELECT over AlertEvent.

    Validates ``modalities`` against the canonical 5-modality set and raises
    ``HTTPException(400)`` for unknown values. Wrap operations in EXISTS
    subqueries so the SQL plan doesn't fan out into a cartesian product
    against Material / ReviewTask.
    """
    from sqlalchemy import exists as _exists

    if status_ and status_ != "all":
        base = base.where(AlertEvent.status == status_)
    if rule_code:
        base = base.where(AlertEvent.rule_code == rule_code)
    if win is not None:
        base = base.where(AlertEvent.created_at >= win.start)
        base = base.where(AlertEvent.created_at < win.end)

    if modalities:
        valid = set(AUDIT_MODALITIES)
        unknown = [m for m in modalities if m not in valid]
        if unknown:
            raise HTTPException(
                status_code=400, detail=f"unsupported modality: {', '.join(unknown)}"
            )
        match = _build_modality_exists(list(modalities))
        if match is not None:
            mod_clause = _exists().where(
                (Material.id == ReviewTask.material_id) & match
            )
            base = base.where(mod_clause)

    if strategy_codes:
        from app.models.strategy import Strategy

        strat_clause = _exists().where(
            (ReviewTask.material_id == Material.id)
            & or_(
                ReviewTask.machine_result["strategy"]["code"].astext.in_(list(strategy_codes)),
                ReviewTask.strategy_id.in_(
                    select(Strategy.id).where(Strategy.code.in_(list(strategy_codes)))
                ),
            )
        )
        base = base.where(strat_clause)

    if account_ids:
        base = base.where(
            _exists().where(
                (Material.id == ReviewTask.material_id)
                & or_(
                    *[
                        Material.extra_metadata["account_id"].astext == a
                        for a in account_ids
                    ]
                )
            )
        )

    if ips:
        base = base.where(
            _exists().where(
                (Material.id == ReviewTask.material_id)
                & or_(*[Material.extra_metadata["ip"].astext == i for i in ips])
            )
        )

    if channels:
        base = base.where(
            _exists().where(
                (Material.id == ReviewTask.material_id)
                & or_(
                    *[
                        Material.extra_metadata["channel"].astext == c
                        for c in channels
                    ]
                )
            )
        )

    if risk_label_paths:
        label_predicates = []
        for p in risk_label_paths:
            segments = [seg for seg in p.split("/") if seg and seg != "*"]
            for seg in segments:
                like = f'%"{seg}"%'
                label_predicates.append(
                    func.cast(ReviewTask.machine_result, _String).like(like)
                )
        if label_predicates:
            base = base.where(
                _exists().where(
                    (ReviewTask.material_id == Material.id)
                    & and_(*label_predicates)
                )
            )

    return base


@router.get("", response_model=AlertPage)
async def list_alerts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    status_: Optional[str] = Query(None, alias="status", pattern="^(open|acknowledged|all)$"),
    rule_code: Optional[str] = Query(None),
    window: Optional[str] = Query(
        None, description="时间窗: 1h|24h|7d. 不传 + 不传 start/end 则不限时间"
    ),
    start: Optional[datetime] = Query(
        None, description="自定义窗口起点 (ISO 8601), 与 end 一起使用"
    ),
    end: Optional[datetime] = Query(
        None, description="自定义窗口终点 (ISO 8601), 与 start 一起使用"
    ),
    modalities: Optional[List[str]] = Query(
        None, description="审核模态过滤 (image/text/video/audio/document), 可重复"
    ),
    strategy_codes: Optional[List[str]] = Query(
        None, description="策略 code, 可重复"
    ),
    account_ids: Optional[List[str]] = Query(
        None, description="业务账号 (material.metadata.account_id), 可重复"
    ),
    ips: Optional[List[str]] = Query(
        None, description="IP (material.metadata.ip), 可重复"
    ),
    channels: Optional[List[str]] = Query(
        None, description="渠道 (material.metadata.channel), 可重复"
    ),
    risk_label_paths: Optional[List[str]] = Query(
        None,
        description="风险标签路径 (一级/二级/三级 code, 用 '/' 拼接), 可重复. 支持前缀匹配.",
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> AlertPage:
    win = _resolve_optional_window(start, end, window)
    base = select(AlertEvent)
    count_base = select(func.count(AlertEvent.id))
    base = _apply_alerts_filters(
        base,
        status_=status_,
        rule_code=rule_code,
        win=win,
        modalities=modalities,
        strategy_codes=strategy_codes,
        account_ids=account_ids,
        ips=ips,
        channels=channels,
        risk_label_paths=risk_label_paths,
    )
    count_base = _apply_alerts_filters(
        count_base,
        status_=status_,
        rule_code=rule_code,
        win=win,
        modalities=modalities,
        strategy_codes=strategy_codes,
        account_ids=account_ids,
        ips=ips,
        channels=channels,
        risk_label_paths=risk_label_paths,
    )

    total = await db.scalar(count_base) or 0
    rows = (
        await db.execute(base.order_by(AlertEvent.created_at.desc()).offset(offset).limit(limit))
    ).scalars().all()
    page = max(1, (offset // limit) + 1) if limit else 1
    return AlertPage(
        items=[_to_out(a) for a in rows],
        total=int(total),
        page=page,
        size=limit,
    )


@router.post("/{alert_id}/ack", response_model=AlertEventOut)
async def ack_alert(
    alert_id: int,
    body: AlertAckRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("mlr", "admin")),
) -> AlertEventOut:
    alert = await db.get(AlertEvent, alert_id)
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="alert not found")
    if alert.status == "acknowledged":
        return _to_out(alert)
    alert.status = "acknowledged"
    alert.ack_by = user.id
    alert.ack_at = datetime.now(timezone.utc)
    alert.ack_note = body.note
    await db.commit()
    await db.refresh(alert)
    return _to_out(alert)
