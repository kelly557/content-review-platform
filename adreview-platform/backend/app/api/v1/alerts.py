"""Alert events router (异常分析 tab)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.alert_event import AlertEvent
from app.models.user import User
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


@router.get("", response_model=AlertPage)
async def list_alerts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    status_: Optional[str] = Query(None, alias="status", pattern="^(open|acknowledged|all)$"),
    rule_code: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> AlertPage:
    base = select(AlertEvent)
    count_base = select(func.count(AlertEvent.id))
    if status_ and status_ != "all":
        base = base.where(AlertEvent.status == status_)
        count_base = count_base.where(AlertEvent.status == status_)
    if rule_code:
        base = base.where(AlertEvent.rule_code == rule_code)
        count_base = count_base.where(AlertEvent.rule_code == rule_code)
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
