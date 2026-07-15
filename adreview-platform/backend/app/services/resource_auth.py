"""Resource-level permission helpers (admin/superadmin write, mlr read)."""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core.deps import get_current_user
from app.models.user import User, UserRole


WRITE_ROLES = {UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.ROOT_ADMIN}
READ_ROLES = {UserRole.MLR, UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.ROOT_ADMIN}


def require_writer(user=Depends(get_current_user)):
    """Caller must be admin or superadmin. Otherwise 403."""
    if user is None or user.role not in WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员或超级管理员权限",
        )
    return user


def require_reader(user=Depends(get_current_user)):
    """Caller must be mlr / admin / superadmin."""
    if user is None or user.role not in READ_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要登录且具有访问权限",
        )
    return user
