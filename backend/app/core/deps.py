"""Reusable FastAPI dependencies."""
from typing import Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub", 0))
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or user.is_deleted:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_roles(*roles: str):
    """Dependency factory: enforce user role membership.

    superadmin / root_admin 隐式拥有所有角色权限（platform operator 全权），
    不需要在每个 require_roles 调用里手动列出。
    """

    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN):
            return user
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {', '.join(roles)}",
            )
        return user

    return _check


async def require_superadmin(user: User = Depends(get_current_user)) -> User:
    """Dependency: ensure the caller is the root_admin role.

    Used to gate platform-level administrative actions (e.g. API Keys CRUD).
    superadmin（业务超级管理员）不再拥有平台级写权限。
    注：risk_categories 有自己的本地 _require_superadmin，仍放行 superadmin。
    """
    if user.role != UserRole.ROOT_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires role: root_admin",
        )
    return user


# 平台租户标识（与前端 PLATFORM_TENANT_ID 对齐）。tenant_id 为 NULL 的用户
# 视为归属平台租户。
PLATFORM_TENANT_ID = "tnt_default"


def is_platform_admin(user: User | None) -> bool:
    """Plain boolean check (no dependency). 与 require_platform_admin 同语义。

    平台租户管理员（platform admin）= root_admin。
    superadmin 是超级管理员（除租户管理外的所有权限），不再被视为平台管理员。
    供路由内部按平台/业务管理员分支返回不同数据范围时使用。
    """
    if user is None:
        return False
    return user.role == UserRole.ROOT_ADMIN


async def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    """Dependency: platform operator (tenants management).

    平台租户管理员 = root_admin。
    superadmin 不再拥有租户管理权限（与前端 ``tenantAuth.isPlatformAdmin`` 语义一致）。
    """
    if user.role == UserRole.ROOT_ADMIN:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Requires platform admin role",
    )
