"""AuditPoint router (审核点 CRUD)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.models.service import Service
from app.models.user import User
from app.schemas.audit_point import (
    AuditPointBatchCreate,
    AuditPointBatchItem,
    AuditPointBatchResult,
    AuditPointCreate,
    AuditPointOut,
    AuditPointResetResult,
    AuditPointUpdate,
)

router = APIRouter(prefix="/packages", tags=["audit-points"])


async def _ensure_package(db: AsyncSession, code: str) -> Service:
    result = await db.execute(select(Service).where(Service.code == code))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则包不存在")
    return svc


async def _generate_point_code(db: AsyncSession, package_code: str, item_id: int) -> str:
    """Generate a unique audit point code: ap_{item_id}_{n+1}.

    Concurrent safety: relies on the (package_code, code) UniqueConstraint
    to surface a 409 if two requests race to the same n.
    """
    count_stmt = select(func.count(AuditPoint.id)).where(
        AuditPoint.package_code == package_code,
        AuditPoint.item_id == item_id,
    )
    total = (await db.execute(count_stmt)).scalar_one() or 0
    return f"ap_{item_id}_{total + 1}"


@router.get("/{code}/points", response_model=list[AuditPointOut])
async def list_points(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    item_id: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> list[AuditPointOut]:
    await _ensure_package(db, code)
    stmt = select(AuditPoint).where(AuditPoint.package_code == code)
    if item_id is not None:
        stmt = stmt.where(AuditPoint.item_id == item_id)
    if enabled is not None:
        stmt = stmt.where(AuditPoint.is_enabled.is_(enabled))
    stmt = stmt.order_by(AuditPoint.item_id.asc(), AuditPoint.sort_order.asc(), AuditPoint.id.asc())
    rows = list((await db.execute(stmt)).scalars())
    return [AuditPointOut.model_validate(r) for r in rows]


@router.post("/{code}/points", response_model=AuditPointOut, status_code=status.HTTP_201_CREATED)
async def create_point(
    code: str,
    body: AuditPointCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> AuditPointOut:
    await _ensure_package(db, code)
    item = await db.get(AuditItem, body.item_id)
    if not item or item.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在")
    generated_code = await _generate_point_code(db, code, body.item_id)
    point = AuditPoint(
        package_code=code,
        item_id=body.item_id,
        code=generated_code,
        label=generated_code,
        label_cn=body.label_cn,
        description=body.description,
        medium_threshold=body.medium_threshold,
        high_threshold=body.high_threshold,
        scope_text=body.scope_text,
        risk_level=body.risk_level,
        is_enabled=body.is_enabled,
        custom_wordset_id=body.custom_wordset_id,
        sort_order=body.sort_order,
    )
    db.add(point)
    try:
        await db.flush()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="审核点编码生成冲突，请重试",
        )
    await db.refresh(point)
    await db.commit()
    return AuditPointOut.model_validate(point)


@router.put("/{code}/points/{point_id}", response_model=AuditPointOut)
async def update_point(
    code: str,
    point_id: int,
    body: AuditPointUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> AuditPointOut:
    await _ensure_package(db, code)
    point = await db.get(AuditPoint, point_id)
    if not point or point.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核点不存在")
    if body.label_cn is not None:
        point.label_cn = body.label_cn
    if body.description is not None:
        point.description = body.description
    if body.medium_threshold is not None:
        point.medium_threshold = body.medium_threshold
    if body.high_threshold is not None:
        point.high_threshold = body.high_threshold
    if body.scope_text is not None:
        point.scope_text = body.scope_text
    if body.risk_level is not None:
        point.risk_level = body.risk_level
    if body.is_enabled is not None:
        point.is_enabled = body.is_enabled
    if body.custom_wordset_id is not None:
        point.custom_wordset_id = body.custom_wordset_id
    if body.sort_order is not None:
        point.sort_order = body.sort_order
    await db.flush()
    await db.refresh(point)
    await db.commit()
    return AuditPointOut.model_validate(point)


@router.delete("/{code}/points/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_point(
    code: str,
    point_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> None:
    await _ensure_package(db, code)
    point = await db.get(AuditPoint, point_id)
    if not point or point.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核点不存在")
    await db.delete(point)
    await db.commit()


@router.post("/{code}/points/reset", response_model=AuditPointResetResult)
async def reset_points(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> AuditPointResetResult:
    await _ensure_package(db, code)
    stmt = select(AuditPoint).where(AuditPoint.package_code == code)
    rows = list((await db.execute(stmt)).scalars())
    for p in rows:
        p.medium_threshold = 60.0
        p.high_threshold = 90.0
    await db.flush()
    await db.commit()
    return AuditPointResetResult(items=[AuditPointOut.model_validate(p) for p in rows])


@router.post("/{code}/points/batch", response_model=AuditPointBatchResult)
async def create_points_batch(
    code: str,
    body: AuditPointBatchCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> AuditPointBatchResult:
    await _ensure_package(db, code)
    item = await db.get(AuditItem, body.item_id)
    if not item or item.package_code != code:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在"
        )

    items: list[AuditPointBatchItem] = []
    succeeded = 0
    for idx, raw in enumerate(body.points):
        forced = raw.model_copy(update={"item_id": body.item_id})
        try:
            payload = AuditPointCreate.model_validate(forced)
        except ValidationError as ve:
            msg = ve.errors()[0].get("msg", "校验失败") if ve.errors() else "校验失败"
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=raw.label_cn,
                    status="error",
                    error=msg,
                )
            )
            continue

        try:
            generated = await _generate_point_code(db, code, body.item_id)
            point = AuditPoint(
                package_code=code,
                item_id=body.item_id,
                code=generated,
                label=generated,
                label_cn=payload.label_cn,
                description=payload.description,
                medium_threshold=payload.medium_threshold,
                high_threshold=payload.high_threshold,
                scope_text=payload.scope_text,
                risk_level=payload.risk_level,
                is_enabled=payload.is_enabled,
                custom_wordset_id=payload.custom_wordset_id,
                sort_order=payload.sort_order,
            )
            db.add(point)
            await db.flush()
            await db.refresh(point)
            await db.commit()
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=payload.label_cn,
                    status="ok",
                    point=AuditPointOut.model_validate(point),
                )
            )
            succeeded += 1
        except IntegrityError:
            await db.rollback()
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=payload.label_cn,
                    status="error",
                    error="编码冲突，请重试",
                )
            )

    return AuditPointBatchResult(
        succeeded=succeeded,
        failed=len(body.points) - succeeded,
        items=items,
    )