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
    top_accounts_by_ip_by_window,
    top_accounts_by_window,
    top_risk_labels_by_window,
)
from app.schemas.alert import (
    AlertAckRequest,
    AlertEventOut,
    AlertPage,
    AlertRootCauseAccount,
    AlertRootCauseAccountIP,
    AlertRootCauseResponse,
    AlertRootCauseWindow,
)
from app.models.alert_rule import AlertRule
from app.schemas.alert_rule import (
    AlertRuleCreate,
    AlertRuleOut,
    AlertRuleUpdate,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])


# ---------------------------------------------------------------------------
# Root cause routing — rule_code → which aggregation to run.
# ---------------------------------------------------------------------------

ROOT_CAUSE_LABELS: dict[str, str] = {
    "reject_rate_high": "拒绝率异常",
    "high_risk_content_high": "账号高风险阻断异常",
    "high_risk_account_concentration": "高风险账号聚集异常",
    "reject_rate_spike": "拒绝率突升",
    "high_risk_concentration": "高风险账号聚集",
    "submit_drop": "提交量骤降",
}

ROOT_CAUSE_RULES: dict[str, str] = {
    "reject_rate_high": "top_risk_labels",
    "high_risk_content_high": "top_accounts",
    "high_risk_account_concentration": "top_account_ips",
}


def _to_out(a: AlertEvent) -> AlertEventOut:
    return AlertEventOut(
        id=a.id,
        public_id=a.public_id or "",
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


@router.get("/{alert_id}/root-cause", response_model=AlertRootCauseResponse)
async def get_alert_root_cause(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
) -> AlertRootCauseResponse:
    """Per-alert root cause drill-down.

    Routes to one of three aggregations based on ``rule_code``:

    * ``reject_rate_high``                 → top risk labels
    * ``high_risk_content_high``           → top accounts (rejected)
    * ``high_risk_account_concentration``  → top accounts → their top IPs

    The alert's own ``window_start ~ window_end`` defines the aggregation
    window. Optional cohort filters (modality / strategy_code / channel) are
    read from ``AlertEvent.dimension`` so the result reflects the slice that
    triggered the alert.
    """
    alert = await db.get(AlertEvent, alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="alert not found"
        )

    dimension = alert.dimension or {}
    modality = dimension.get("modality")
    strategy_code = dimension.get("strategy_code")
    channel = dimension.get("channel")

    size_min = max(
        int((alert.window_end - alert.window_start).total_seconds() // 60),
        1,
    )
    window = AlertRootCauseWindow(
        start=alert.window_start,
        end=alert.window_end,
        size_min=size_min,
    )

    rule_code = alert.rule_code
    rule_label = ROOT_CAUSE_LABELS.get(rule_code, rule_code)
    route = ROOT_CAUSE_RULES.get(rule_code)

    top_risk_labels: List[dict] = []
    top_accounts: List[AlertRootCauseAccount] = []
    top_account_ips: List[AlertRootCauseAccountIP] = []

    if route == "top_risk_labels":
        rows = await top_risk_labels_by_window(
            db,
            start=alert.window_start,
            end=alert.window_end,
            modality=modality,
            strategy_code=strategy_code,
            limit=10,
        )
        top_risk_labels = rows
    elif route == "top_accounts":
        rows = await top_accounts_by_window(
            db,
            start=alert.window_start,
            end=alert.window_end,
            modality=modality,
            strategy_code=strategy_code,
            channel=channel,
            limit=10,
        )
        top_accounts = [AlertRootCauseAccount(**r) for r in rows]
    elif route == "top_account_ips":
        rows = await top_accounts_by_ip_by_window(
            db,
            start=alert.window_start,
            end=alert.window_end,
            modality=modality,
            strategy_code=strategy_code,
            channel=channel,
            limit=5,
            per_account_ip_limit=3,
        )
        top_account_ips = [AlertRootCauseAccountIP(**r) for r in rows]
    # else: rule_code 不在 ROOT_CAUSE_RULES 里 → 返回空三栏.

    return AlertRootCauseResponse(
        alert_id=alert.id,
        rule_code=rule_code,
        rule_label=rule_label,
        window=window,
        dimension={
            "modality": modality,
            "strategy_code": strategy_code,
            "channel": channel,
        },
        top_risk_labels=top_risk_labels,
        top_accounts=top_accounts,
        top_account_ips=top_account_ips,
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


# ---------------------------------------------------------------------------
# Alert rules — 异常规则配置（前端 anomalyThresholds 持久化）
# ---------------------------------------------------------------------------

# 默认规则（与前端 DEFAULT_ANOMALY_THRESHOLDS 对齐），首次 GET 时 upsert
_DEFAULT_ALERT_RULES = [
    {
        "rule_code": "reject_rate_high",
        "label": "拒绝率异常",
        "metric": "拒绝率",
        "dimension": "审核模态",
        "algorithm": "固定阈值",
        "window_label": "近 1 小时",
        "critical": {"operator": ">", "value": 5, "unit": "%"},
        "warn": {"operator": ">", "value": 3, "unit": "%"},
        "extra_conditions": [],
        "description": "拒绝率过高",
        "enabled": True,
        "source": "default",
    },
    {
        "rule_code": "high_risk_content_high",
        "label": "账号高风险阻断异常",
        "metric": "高风险阻断率",
        "dimension": "审核模态",
        "algorithm": "固定阈值",
        "window_label": "近 1 小时",
        "critical": {"operator": ">", "value": 10, "unit": "%"},
        "warn": {"operator": ">", "value": 5, "unit": "%"},
        "extra_conditions": [],
        "description": "高风险内容占比过高",
        "enabled": True,
        "source": "default",
    },
    {
        "rule_code": "high_risk_account_concentration",
        "label": "高风险账号聚集异常",
        "metric": "高风险账号数",
        "dimension": "全局",
        "algorithm": "固定阈值",
        "window_label": "近 24 小时",
        "critical": {"operator": ">", "value": 5, "unit": "count"},
        "warn": {"operator": ">", "value": 3, "unit": "count"},
        "extra_conditions": [{"field": "request_count", "operator": ">", "value": 10}],
        "description": "同一账号高频高风险",
        "enabled": True,
        "source": "default",
    },
]


@router.get("/rules", response_model=List[AlertRuleOut])
async def list_alert_rules(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[AlertRuleOut]:
    # 首次访问 upsert 默认规则
    for d in _DEFAULT_ALERT_RULES:
        existing = await db.execute(
            select(AlertRule).where(AlertRule.rule_code == d["rule_code"])
        )
        if not existing.scalar_one_or_none():
            db.add(AlertRule(**d))
    await db.commit()
    result = await db.execute(select(AlertRule).order_by(AlertRule.id.asc()))
    return [AlertRuleOut.model_validate(r) for r in result.scalars()]


@router.put("/rules/{rule_code}", response_model=AlertRuleOut)
async def update_alert_rule(
    rule_code: str,
    body: AlertRuleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AlertRuleOut:
    r = await db.scalar(select(AlertRule).where(AlertRule.rule_code == rule_code))
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="规则不存在")
    if body.label is not None:
        r.label = body.label
    if body.critical is not None:
        r.critical = body.critical.model_dump()
    if body.warn is not None:
        r.warn = body.warn.model_dump()
    if body.extra_conditions is not None:
        r.extra_conditions = [c.model_dump() for c in body.extra_conditions]
    if body.description is not None:
        r.description = body.description
    if body.enabled is not None:
        r.enabled = body.enabled
    await db.commit()
    await db.refresh(r)
    return AlertRuleOut.model_validate(r)


@router.post("/rules", response_model=AlertRuleOut, status_code=status.HTTP_201_CREATED)
async def create_alert_rule(
    body: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AlertRuleOut:
    existing = await db.execute(
        select(AlertRule).where(AlertRule.rule_code == body.rule_code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, detail="rule_code 已存在")
    r = AlertRule(
        rule_code=body.rule_code,
        label=body.label,
        metric=body.metric,
        dimension=body.dimension or "全局",
        algorithm=body.algorithm or "固定阈值",
        window_label=body.window_label or "近 1 小时",
        critical=body.critical.model_dump() if body.critical else None,
        warn=body.warn.model_dump() if body.warn else None,
        extra_conditions=[c.model_dump() for c in body.extra_conditions] if body.extra_conditions else [],
        description=body.description,
        enabled=body.enabled if body.enabled is not None else True,
        source=body.source or "custom",
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return AlertRuleOut.model_validate(r)


@router.delete("/rules/{rule_code}", status_code=status.HTTP_200_OK)
async def delete_alert_rule(
    rule_code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> dict:
    r = await db.scalar(select(AlertRule).where(AlertRule.rule_code == rule_code))
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="规则不存在")
    await db.delete(r)
    await db.commit()
    return {"ok": True, "rule_code": rule_code}
