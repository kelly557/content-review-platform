"""Role-permission schemas."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

from app.schemas.common import ORMBase


class RolePermissionOut(ORMBase):
    role_key: str
    menu_key: str
    permissions: Optional[List[str]] = None
    updated_at: Optional[datetime] = None


class RolePermissionsUpdate(BaseModel):
    # 批量替换某 role 下所有 menu 的权限
    items: List[RolePermissionOut]


class RolePermissionUpsert(BaseModel):
    menu_key: str
    permissions: List[str]
