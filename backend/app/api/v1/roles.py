"""Roles metadata router (Phase 4 — 角色元数据 CRUD).

约定:
- 权限模型双轨: ``users.role`` 仍为 enum, 本路由只管理 ``roles`` 表元数据
  (display_name / description / is_active / sort_order), 不上 FK。
- 守卫: ``require_roles("admin", "superadmin")`` — 与 ``/users`` 一致。
- key / is_builtin 不允许改 (UserRole enum 是静态约束); 业务层不锁 builtin 删除
  (产品决策: 不锁, 被锁系统时走 init_db 回滚)。
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.db.session import get_db
from app.models.role import Role
from app.models.role_permission import RolePermission
from app.models.user import User
from app.schemas.role import (
    RoleCreate,
    RoleListResponse,
    RoleOption,
    RoleOut,
    RoleUpdate,
)
from app.schemas.role_permission import RolePermissionOut, RolePermissionsUpdate

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=RoleListResponse)
async def list_roles(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> RoleListResponse:
    result = await db.execute(
        select(Role).order_by(Role.id.asc())
    )
    items: List[Role] = list(result.scalars())
    return RoleListResponse(
        items=[RoleOut.model_validate(r) for r in items],
        total=len(items),
    )


@router.get("/options", response_model=List[RoleOption])
async def list_role_options(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> List[RoleOption]:
    """仅返回 active 角色, 给前端 Tab/下拉用。"""
    result = await db.execute(
        select(Role)
        .where(Role.is_active == True)  # noqa: E712
        .order_by(Role.id.asc())
    )
    return [
        RoleOption(key=r.key, display_name=r.display_name, is_active=r.is_active)
        for r in result.scalars()
    ]


@router.post("", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> Role:
    exists = await db.execute(select(Role).where(Role.key == body.key))
    if exists.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"role key '{body.key}' already exists",
        )
    role = Role(
        key=body.key,
        display_name=body.display_name,
        description=body.description,
        is_active=body.is_active,
        is_builtin=False,  # 手动新建一律非 builtin
    )
    db.add(role)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"role key '{body.key}' already exists",
        ) from exc
    await db.commit()
    await db.refresh(role)
    return role


@router.patch("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: int,
    body: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> Role:
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="role not found"
        )
    if body.display_name is not None:
        role.display_name = body.display_name
    if body.description is not None:
        role.description = body.description
    if body.is_active is not None:
        role.is_active = body.is_active
    await db.flush()
    await db.commit()
    await db.refresh(role)
    return role


@router.delete("/{role_id}", status_code=status.HTTP_200_OK)
async def delete_role(
    role_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> dict:
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="role not found"
        )
    # 业务层不锁 builtin 删除（产品决策）
    # 但对 UI 提示: builtin 角色删除后, 现存 users.role enum 值仍可用,
    # 只是 roles 表里少了对应的元数据记录
    await db.delete(role)
    await db.commit()
    return {"ok": True, "id": role_id}


# ──────────────────────────────────────────────────────────────
# 权限矩阵 — /roles/{role_key}/permissions
# ──────────────────────────────────────────────────────────────


@router.get("/{role_key}/permissions", response_model=list[RolePermissionOut])
async def list_role_permissions(
    role_key: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> list[RolePermissionOut]:
    result = await db.execute(
        select(RolePermission).where(RolePermission.role_key == role_key)
    )
    return [RolePermissionOut.model_validate(r) for r in result.scalars()]


@router.put("/{role_key}/permissions", response_model=list[RolePermissionOut])
async def replace_role_permissions(
    role_key: str,
    body: RolePermissionsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> list[RolePermissionOut]:
    # 批量替换: 先删后插
    result = await db.execute(
        select(RolePermission).where(RolePermission.role_key == role_key)
    )
    for r in result.scalars():
        await db.delete(r)
    await db.flush()
    for item in body.items:
        rp = RolePermission(
            role_key=role_key,
            menu_key=item.menu_key,
            permissions=item.permissions,
        )
        db.add(rp)
    await db.flush()
    await db.commit()
    result = await db.execute(
        select(RolePermission).where(RolePermission.role_key == role_key)
    )
    return [RolePermissionOut.model_validate(r) for r in result.scalars()]
