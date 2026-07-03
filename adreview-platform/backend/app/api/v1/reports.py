"""Reports router: simple aggregates (efficiency stats, record export)."""
from __future__ import annotations

import csv
from datetime import datetime, timedelta
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit import AuditEvent
from app.models.material import Material, MaterialStatus
from app.models.review import ReviewTask
from app.models.user import User
from app.schemas.common import ORMBase
from pydantic import BaseModel

router = APIRouter(prefix="/reports", tags=["reports"])


class StatsBucket(BaseModel):
    bucket: str
    submitted: int
    approved: int
    rejected: int


class OverviewStats(BaseModel):
    total_materials: int
    in_review: int
    approved: int
    rejected: int
    avg_review_hours: float | None


@router.get("/overview", response_model=OverviewStats)
async def overview(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
) -> OverviewStats:
    total = await db.scalar(select(func.count(Material.id))) or 0
    in_review = await db.scalar(
        select(func.count(Material.id)).where(Material.status == MaterialStatus.IN_REVIEW)
    ) or 0
    approved = await db.scalar(
        select(func.count(Material.id)).where(Material.status == MaterialStatus.APPROVED)
    ) or 0
    rejected = await db.scalar(
        select(func.count(Material.id)).where(Material.status == MaterialStatus.REJECTED)
    ) or 0

    avg_hours = await db.scalar(
        select(
            func.avg(
                func.extract("epoch", ReviewTask.completed_at - ReviewTask.created_at) / 3600.0
            )
        ).where(ReviewTask.completed_at.is_not(None))
    )

    return OverviewStats(
        total_materials=total,
        in_review=in_review,
        approved=approved,
        rejected=rejected,
        avg_review_hours=float(avg_hours) if avg_hours is not None else None,
    )


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
