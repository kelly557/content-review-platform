"""Tenants router — tenant management.

读取守卫: admin/superadmin/root_admin 可调用 (业务管理员只见本租户,
平台管理员见全部); 写操作守卫: require_platform_admin (root_admin 或平台
superadmin)。
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import is_platform_admin, require_platform_admin, require_roles
from app.db.session import get_db
from app.models.api_key import ApiKey
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import TenantCreate, TenantOut, TenantUpdate

router = APIRouter(prefix="/admin/tenants", tags=["admin-tenants"])


async def _to_out(db: AsyncSession, t: Tenant) -> TenantOut:
    key_count = await db.scalar(
        select(func.count(ApiKey.id)).where(ApiKey.tenant_id == t.id)
    )
    user_count = await db.scalar(
        select(func.count(User.id)).where(User.tenant_id == t.id)
    )
    return TenantOut.model_validate(t).model_copy(
        update={"key_count": key_count or 0, "user_count": user_count or 0}
    )


@router.get("", response_model=List[TenantOut])
async def list_tenants(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "superadmin")),
) -> List[TenantOut]:
    # 平台管理员见全部租户; 业务管理员仅见自己归属的租户
    if is_platform_admin(user):
        result = await db.execute(select(Tenant).order_by(Tenant.id.asc()))
        tenants = list(result.scalars())
    elif user.tenant_id is not None:
        t = await db.get(Tenant, user.tenant_id)
        tenants = [t] if t else []
    else:
        tenants = []
    return [await _to_out(db, t) for t in tenants]


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> TenantOut:
    exists = await db.execute(select(Tenant).where(Tenant.code == body.code))
    if exists.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"租户 code '{body.code}' 已存在",
        )
    t = Tenant(
        code=body.code,
        name=body.name,
        contact_email=body.contact_email,
        is_active=body.is_active,
    )
    db.add(t)
    await db.flush()
    await db.commit()
    await db.refresh(t)
    return await _to_out(db, t)


@router.patch("/{tenant_id}", response_model=TenantOut)
async def update_tenant(
    tenant_id: int,
    body: TenantUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> TenantOut:
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="租户不存在")
    if body.name is not None:
        t.name = body.name
    if body.contact_email is not None:
        t.contact_email = body.contact_email
    if body.is_active is not None:
        t.is_active = body.is_active
    await db.flush()
    await db.commit()
    await db.refresh(t)
    return await _to_out(db, t)


@router.delete("/{tenant_id}", status_code=status.HTTP_200_OK)
async def delete_tenant(
    tenant_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> dict:
    t = await db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="租户不存在")
    await db.delete(t)
    await db.commit()
    return {"ok": True, "id": tenant_id}
