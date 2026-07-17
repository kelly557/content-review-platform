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
    """Dependency: ensure the caller is the superadmin or root_admin role.

    Used to gate administrative actions that should only be reachable by the
    platform operator (e.g. editing 通用 AuditItem/AuditPoint, viewing the
    通用 platform libraries).
    """
    if user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires role: superadmin",
        )
    return user
