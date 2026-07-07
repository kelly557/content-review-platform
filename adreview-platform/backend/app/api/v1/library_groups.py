"""LibraryGroup CRUD.

Simple management: list/create/rename/reorder/soft-delete. Groups cannot be
hard-deleted while libraries reference them; soft-delete sets is_deleted=true
and any subsequent GET filters them out unless ``include_deleted=true``.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.library_group import LibraryGroup
from app.models.library import Library
from app.models.user import User
from app.schemas.common import Page
from app.schemas.library_group import (
    LibraryGroupCreate,
    LibraryGroupOut,
    LibraryGroupUpdate,
)

router = APIRouter(prefix="/library-groups", tags=["library-groups"])


def _to_out(g: LibraryGroup, library_count: int = 0) -> LibraryGroupOut:
    return LibraryGroupOut.model_validate(
        {
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "sort_order": g.sort_order,
            "is_deleted": g.is_deleted,
            "deleted_at": g.deleted_at,
            "created_at": g.created_at,
            "updated_at": g.updated_at,
        }
    )


@router.get("", response_model=Page[LibraryGroupOut])
async def list_library_groups(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(100, ge=1, le=200),
    include_deleted: bool = Query(False),
    q: Optional[str] = None,
) -> Page[LibraryGroupOut]:
    stmt = select(LibraryGroup)
    conds = []
    if not include_deleted:
        conds.append(LibraryGroup.is_deleted == False)  # noqa: E712
    if q:
        conds.append(LibraryGroup.name.ilike(f"%{q}%"))
    if conds:
        stmt = stmt.where(and_(*conds))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(LibraryGroup.sort_order.asc(), LibraryGroup.id.asc()).offset(
        (page - 1) * size
    ).limit(size)
    items = [_to_out(g) for g in (await db.execute(stmt)).scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=LibraryGroupOut, status_code=status.HTTP_201_CREATED)
async def create_library_group(
    body: LibraryGroupCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryGroupOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    existing = await db.execute(
        select(LibraryGroup).where(LibraryGroup.name == name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="分组名称已存在")
    g = LibraryGroup(
        name=name,
        description=body.description,
        sort_order=body.sort_order,
    )
    db.add(g)
    await db.flush()
    await db.refresh(g)
    await db.commit()
    return _to_out(g)


@router.put("/{group_id}", response_model=LibraryGroupOut)
async def update_library_group(
    group_id: int,
    body: LibraryGroupUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryGroupOut:
    g = await db.get(LibraryGroup, group_id)
    if not g or g.is_deleted:
        raise HTTPException(status_code=404, detail="分组不存在")
    if body.name is not None:
        new_name = body.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="分组名称不能为空")
        if new_name != g.name:
            dup = await db.execute(
                select(LibraryGroup).where(
                    and_(LibraryGroup.name == new_name, LibraryGroup.id != g.id)
                )
            )
            if dup.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="分组名称已存在")
            g.name = new_name
    if body.description is not None:
        g.description = body.description
    if body.sort_order is not None:
        g.sort_order = body.sort_order
    await db.flush()
    await db.refresh(g)
    await db.commit()
    return _to_out(g)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_library_group(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    g = await db.get(LibraryGroup, group_id)
    if not g or g.is_deleted:
        raise HTTPException(status_code=404, detail="分组不存在")

    libs = await db.execute(
        select(func.count())
        .select_from(Library)
        .where(and_(Library.group_id == group_id, Library.is_deleted == False))  # noqa: E712
    )
    used = libs.scalar() or 0
    if used > 0:
        raise HTTPException(
            status_code=409,
            detail=f"该分组下仍有 {used} 个库,请先转移或删除这些库",
        )

    g.is_deleted = True
    g.deleted_at = datetime.utcnow()
    await db.flush()
    await db.commit()