"""Webhook IP allowlist CRUD."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.trigger import WebhookIpAllowlist
from app.models.user import User, UserRole
from app.schemas.common import ORMBase, Page
from app.schemas.trigger import (
    WebhookAllowlistCreate,
    WebhookAllowlistOut,
    WebhookAllowlistUpdate,
)
from app.services import ip_allowlist

router = APIRouter(prefix="/webhook-allowlist", tags=["webhook-allowlist"])


def _require_admin(user: User) -> None:
    if user.role.value != UserRole.ADMIN.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin only")


@router.get("", response_model=Page[WebhookAllowlistOut])
async def list_allowlist(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = 1,
    size: int = 50,
) -> Page[WebhookAllowlistOut]:
    _require_admin(user)
    from sqlalchemy import func as _f

    total = await db.scalar(
        select(_f.count(WebhookIpAllowlist.id))
    ) or 0
    base = select(WebhookIpAllowlist).order_by(WebhookIpAllowlist.id.desc())
    rows = await db.execute(base.offset((page - 1) * size).limit(size))
    items = [WebhookAllowlistOut.model_validate(r) for r in rows.scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=WebhookAllowlistOut, status_code=status.HTTP_201_CREATED)
async def create_allowlist_entry(
    body: WebhookAllowlistCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WebhookAllowlistOut:
    _require_admin(user)
    try:
        canonical = ip_allowlist.validate_cidr(body.cidr)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid CIDR: {exc}"
        ) from exc
    body.cidr = canonical

    existing = await db.scalar(
        select(WebhookIpAllowlist).where(WebhookIpAllowlist.cidr == body.cidr)
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="CIDR already exists")

    row = WebhookIpAllowlist(
        cidr=body.cidr,
        label=body.label,
        note=body.note,
        is_enabled=body.is_enabled,
        created_by=user.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await ip_allowlist.refresh(db)
    return WebhookAllowlistOut.model_validate(row)


@router.put("/{entry_id}", response_model=WebhookAllowlistOut)
async def update_allowlist_entry(
    entry_id: int,
    body: WebhookAllowlistUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WebhookAllowlistOut:
    _require_admin(user)
    row = await db.get(WebhookIpAllowlist, entry_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="entry not found")

    data = body.model_dump(exclude_unset=True)
    if "cidr" in data and data["cidr"]:
        try:
            data["cidr"] = ip_allowlist.validate_cidr(data["cidr"])
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid CIDR: {exc}"
            ) from exc
    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    await ip_allowlist.refresh(db)
    return WebhookAllowlistOut.model_validate(row)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_allowlist_entry(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    _require_admin(user)
    row = await db.get(WebhookIpAllowlist, entry_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="entry not found")
    await db.delete(row)
    await db.commit()
    await ip_allowlist.refresh(db)