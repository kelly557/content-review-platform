"""Service category CRUD routes."""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.db.session import get_db
from app.models.service import Service
from app.models.service_category import ServiceCategory
from app.models.user import User
from app.schemas.common import Page
from app.schemas.service_category import (
    ServiceCategoryCreate,
    ServiceCategoryOut,
    ServiceCategoryUpdate,
)

router = APIRouter(prefix="/service-categories", tags=["service-categories"])


def _slugify(name: str) -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", "_", name).strip("_").lower()
    return cleaned or "category"


async def _next_code(db: AsyncSession, base: str) -> str:
    base_code = _slugify(base)
    result = await db.execute(
        select(ServiceCategory).where(ServiceCategory.code.like(f"{base_code}%"))
    )
    existing = list(result.scalars())
    if not any(c.code == base_code for c in existing):
        return base_code
    nums = []
    for c in existing:
        suffix = c.code[len(base_code):]
        if suffix and suffix.isdigit():
            nums.append(int(suffix))
    return f"{base_code}_{(max(nums) + 1) if nums else 2}"


@router.get("", response_model=Page[ServiceCategoryOut])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    q: Optional[str] = None,
) -> Page[ServiceCategoryOut]:
    stmt = select(ServiceCategory)
    if q:
        stmt = stmt.where(ServiceCategory.name.ilike(f"%{q}%"))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(ServiceCategory.is_system.desc(), ServiceCategory.sort_order.asc(), ServiceCategory.id.asc())
    stmt = stmt.offset((page - 1) * size).limit(size)
    result = await db.execute(stmt)
    items = [ServiceCategoryOut.model_validate(c) for c in result.scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=ServiceCategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: ServiceCategoryCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> ServiceCategory:
    code = body.code
    if code:
        existing = await db.execute(select(ServiceCategory).where(ServiceCategory.code == code))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="分类编码已存在")
    else:
        code = await _next_code(db, body.name)

    category = ServiceCategory(
        code=code,
        name=body.name,
        description=body.description,
        is_system=False,
        sort_order=body.sort_order,
    )
    db.add(category)
    await db.flush()
    await db.commit()
    return category


@router.get("/{category_id}", response_model=ServiceCategoryOut)
async def get_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> ServiceCategory:
    cat = await db.get(ServiceCategory, category_id)
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分类不存在")
    return cat


@router.put("/{category_id}", response_model=ServiceCategoryOut)
async def update_category(
    category_id: int,
    body: ServiceCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> ServiceCategory:
    cat = await db.get(ServiceCategory, category_id)
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分类不存在")
    if cat.is_system and body.is_active is not None and not body.is_active:
        svc_count = await db.scalar(
            select(func.count()).select_from(Service).where(Service.category_id == cat.id)
        )
        if svc_count and svc_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="系统分类下有服务，不可禁用",
            )

    if body.name is not None:
        cat.name = body.name
    if body.description is not None:
        cat.description = body.description
    if body.sort_order is not None:
        cat.sort_order = body.sort_order
    if body.is_active is not None:
        cat.is_active = body.is_active
    await db.flush()
    await db.refresh(cat)
    await db.commit()
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> Response:
    cat = await db.get(ServiceCategory, category_id)
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分类不存在")
    if cat.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="系统分类不可删除")
    svc_count = await db.scalar(
        select(func.count()).select_from(Service).where(Service.category_id == cat.id)
    )
    if svc_count and svc_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该分类下仍有服务，请先迁移服务后再删除",
        )
    await db.delete(cat)
    await db.flush()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
