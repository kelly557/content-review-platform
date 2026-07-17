"""Service catalog router."""
import re
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.service import Service, ServiceScope
from app.models.user import User
from app.schemas.common import Page
from app.schemas.service import ServiceCreate, ServiceOut, ServiceUpdate

router = APIRouter(prefix="/services", tags=["services"])


@router.get("", response_model=Page[ServiceOut])
async def list_services(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    scope: Optional[ServiceScope] = None,
    q: Optional[str] = None,
    category_id: Optional[int] = Query(None, description="单个分类 id"),
    category_ids: Optional[List[int]] = Query(None, description="多个分类 id（IN 查询）"),
) -> Page[ServiceOut]:
    stmt = select(Service)
    conditions = []
    if scope:
        conditions.append(Service.scope == scope)
    if q:
        conditions.append(or_(Service.name.ilike(f"%{q}%"), Service.code.ilike(f"%{q}%")))
    if category_id is not None:
        conditions.append(Service.category_id == category_id)
    elif category_ids:
        conditions.append(Service.category_id.in_(category_ids))
    if conditions:
        stmt = stmt.where(and_(*conditions))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(Service.id.asc()).offset((page - 1) * size).limit(size)
    result = await db.execute(stmt)
    items = [ServiceOut.model_validate(s) for s in result.scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
async def create_service(
    body: ServiceCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Service:
    code = body.code
    if code:
        existing = await db.execute(select(Service).where(Service.code == code))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="服务编码已存在")
    else:
        slug = re.sub(r"[^\w\u4e00-\u9fff]+", "_", body.name).strip("_").lower()
        code = f"custom_{slug}_{int(time.time())}"

    svc = Service(
        code=code,
        name=body.name,
        scope=body.scope,
        description=body.description,
        is_active=False,
        is_custom=True,
        category_id=body.category_id,
    )
    db.add(svc)
    await db.flush()
    await db.commit()
    return svc


@router.get("/{service_id}", response_model=ServiceOut)
async def get_service(
    service_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Service:
    svc = await db.get(Service, service_id)
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="服务不存在")
    return svc


@router.put("/{service_id}", response_model=ServiceOut)
async def update_service(
    service_id: int,
    body: ServiceUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Service:
    svc = await db.get(Service, service_id)
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="服务不存在")
    if not svc.is_custom:
        if body.name is not None or body.scope is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="系统服务的名称和场景不可修改",
            )

    if body.name is not None:
        svc.name = body.name
    if body.description is not None:
        svc.description = body.description
    if body.scope is not None and svc.is_custom:
        svc.scope = body.scope
    if body.is_active is not None:
        svc.is_active = body.is_active
    if body.category_id is not None:
        svc.category_id = body.category_id
    await db.flush()
    await db.refresh(svc)
    await db.commit()
    return svc


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_service(
    service_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Response:
    svc = await db.get(Service, service_id)
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="服务不存在")
    if not svc.is_custom:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="系统服务不可删除")
    await db.delete(svc)
    await db.flush()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
