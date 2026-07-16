"""Reports router: simple aggregates (efficiency stats, record export).

Historically a single ``/overview`` endpoint; expanded for the Analytics page
(趋势 / 异常 / 质量) in 2025-Q3. See ``app.services.report_metrics`` for the
underlying computations and ``app.schemas.analytics`` for the response shapes.
"""
from __future__ import annotations

import csv
from datetime import datetime, timedelta
from io import StringIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit import AuditEvent
from app.models.material import Material, MaterialStatus
from app.models.review import ReviewTask
from app.models.user import User
from app.schemas.analytics import (
    AnomalyResponse,
    OverviewStats,
    QualityResponse,
    RiskDistributionResponse,
    RiskTrendResponse,
    TopRiskLabelsResponse,
    TrendResponse,
)
from app.services.report_metrics import (
    SUPPORTED_WINDOWS,
    anomaly as anomaly_metric,
    bucket_granularity,
    overview as overview_metric,
    quality as quality_metric,
    resolve_custom_window,
    resolve_window,
    risk_distribution as risk_distribution_metric,
    risk_trend as risk_trend_metric,
    top_risk_labels as top_risk_labels_metric,
    trend as trend_metric,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _resolve_optional_range(
    start: Optional[datetime],
    end: Optional[datetime],
):
    """Resolve an optional ``[start, end)`` pair into a ``Window`` or ``None``.

    Returns ``None`` when either side is missing so the caller can fall back
    to the ``window`` shorthand. Raises ``HTTPException(400)`` if both sides
    are present but invalid (start >= end, or span > 90 days).
    """
    if start is None and end is None:
        return None
    if start is None or end is None:
        raise HTTPException(
            status_code=400,
            detail="start and end must be provided together",
        )
    try:
        return resolve_custom_window(start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Overview — keeps the original shape, but adds reject/review/approve rates.
# ---------------------------------------------------------------------------


@router.get("/overview", response_model=OverviewStats)
async def overview(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    window: str = Query("7d", description="时间窗: today|7d|30d"),
    start: Optional[datetime] = Query(
        None, description="自定义窗口起点 (ISO 8601), 与 end 一起使用"
    ),
    end: Optional[datetime] = Query(
        None, description="自定义窗口终点 (ISO 8601), 与 start 一起使用"
    ),
) -> OverviewStats:
    custom = _resolve_optional_range(start, end)
    w = custom or resolve_window(window)
    data = await overview_metric(db, w)
    return OverviewStats(**data)


# ---------------------------------------------------------------------------
# Trend — daily/hourly series for one core metric
# ---------------------------------------------------------------------------


@router.get("/trend", response_model=TrendResponse)
async def trend(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    metric: str = Query(
        "reject_rate",
        pattern="^(reject_rate|review_rate|approve_rate|submitted)$",
    ),
    window: str = Query("7d"),
    granularity: Optional[str] = Query(None),
    start: Optional[datetime] = Query(
        None, description="自定义窗口起点 (ISO 8601), 与 end 一起使用"
    ),
    end: Optional[datetime] = Query(
        None, description="自定义窗口终点 (ISO 8601), 与 start 一起使用"
    ),
) -> TrendResponse:
    custom = _resolve_optional_range(start, end)
    w = custom or resolve_window(window)
    gran = granularity or bucket_granularity(w)
    data = await trend_metric(db, metric=metric, window=w, granularity=gran)
    return TrendResponse(**data)


# ---------------------------------------------------------------------------
# Anomaly — current snapshot + recent alerts
# ---------------------------------------------------------------------------


@router.get("/anomaly", response_model=AnomalyResponse)
async def anomaly(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    window: str = Query("1h", description="监控时间窗, e.g. 1h, 24h"),
    start: Optional[datetime] = Query(
        None, description="自定义窗口起点 (ISO 8601), 与 end 一起使用"
    ),
    end: Optional[datetime] = Query(
        None, description="自定义窗口终点 (ISO 8601), 与 start 一起使用"
    ),
) -> AnomalyResponse:
    custom = _resolve_optional_range(start, end)
    if custom is None:
        if window not in SUPPORTED_WINDOWS:
            raise HTTPException(status_code=400, detail=f"unsupported window: {window}")
        w = resolve_window(window)
    else:
        w = custom
    gran = bucket_granularity(w)
    data = await anomaly_metric(db, window=w, granularity=gran)
    return AnomalyResponse(**data)


# ---------------------------------------------------------------------------
# Quality — machine-vs-human analysis
# ---------------------------------------------------------------------------


@router.get("/quality", response_model=QualityResponse)
async def quality(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    window: str = Query("7d"),
    strategy_code: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
) -> QualityResponse:
    w = resolve_window(window)
    data = await quality_metric(db, window=w, strategy_code=strategy_code, limit=limit)
    return QualityResponse(**data)


# ---------------------------------------------------------------------------
# Quality — CSV export
# ---------------------------------------------------------------------------


@router.get("/quality/export.csv")
async def export_quality(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    window: str = Query("7d"),
    strategy_code: Optional[str] = Query(None),
) -> StreamingResponse:
    w = resolve_window(window)
    data = await quality_metric(db, window=w, strategy_code=strategy_code, limit=1000)
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Task ID",
            "Material ID",
            "策略",
            "机审结论",
            "人审结论",
            "判定",
            "反馈",
            "完成时间",
        ]
    )
    for r in data["detail"]:
        writer.writerow(
            [
                r["task_id"],
                r["material_id"],
                r.get("strategy_code") or "",
                r.get("machine_decision") or "",
                r.get("human_decision") or "",
                r.get("verdict") or "",
                (r.get("feedback") or "").replace("\n", " ")[:500],
                r["completed_at"].isoformat() if r.get("completed_at") else "",
            ]
        )
    buf.seek(0)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="adreview-quality-{stamp}.csv"'
        },
    )


# ---------------------------------------------------------------------------
# Risk dashboard (overview page)
# ---------------------------------------------------------------------------


@router.get("/risk/trend", response_model=RiskTrendResponse)
async def risk_trend(
    db: AsyncSession = Depends(get_db),
    _current: User = Depends(get_current_user),
    days: int = Query(7, ge=1, le=90),
    material_types: Optional[list[str]] = Query(
        None,
        description="素材类型过滤 (text/image/video/pdf), 可重复",
    ),
) -> RiskTrendResponse:
    data = await risk_trend_metric(db, days=days, material_types=material_types)
    return RiskTrendResponse(**data)


@router.get("/risk/distribution", response_model=RiskDistributionResponse)
async def risk_distribution(
    db: AsyncSession = Depends(get_db),
    _current: User = Depends(get_current_user),
    days: int = Query(7, ge=1, le=90),
) -> RiskDistributionResponse:
    data = await risk_distribution_metric(db, days=days)
    return RiskDistributionResponse(**data)


@router.get("/risk/top-labels", response_model=TopRiskLabelsResponse)
async def risk_top_labels(
    db: AsyncSession = Depends(get_db),
    _current: User = Depends(get_current_user),
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(5, ge=1, le=20),
) -> TopRiskLabelsResponse:
    data = await top_risk_labels_metric(db, days=days, limit=limit)
    return TopRiskLabelsResponse(**data)


# ---------------------------------------------------------------------------
# Audit log CSV (unchanged)
# ---------------------------------------------------------------------------


@router.get("/audit/export.csv")
async def export_audit(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
    days: int = Query(30, ge=1, le=365),
) -> StreamingResponse:
    since = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        select(AuditEvent).where(AuditEvent.created_at >= since).order_by(AuditEvent.id)
    )

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "created_at", "actor_id", "action", "entity_type", "entity_id", "payload"])
    for ev in result.scalars():
        writer.writerow([ev.id, ev.created_at.isoformat(), ev.actor_id, ev.action, ev.entity_type, ev.entity_id, ev.payload])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit.csv"'},
    )
