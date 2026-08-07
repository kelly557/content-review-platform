"""Role metadata schemas (Phase 4)."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserRole


# 必须与 UserRole enum 值一致；这里显式列出避免 enum 改名时静默漂移
ROLE_KEYS: List[str] = [r.value for r in UserRole]

# key 格式: 小写字母开头, 后续仅小写字母/数字/下划线, 长度 1-32。
# 允许 key 不在 UserRole enum 内: 前端 admin 可以"占位"建自定义角色元数据,
# 若要将该角色分配给 user, 仍需后端 dev 同步在 UserRole enum 添加同值。
ROLE_KEY_PATTERN = r"^[a-z][a-z0-9_]*$"


class RoleCreate(BaseModel):
    key: str = Field(min_length=1, max_length=32)
    display_name: str = Field(min_length=1, max_length=64)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True

    @field_validator("key")
    @classmethod
    def _key_format_check(cls, v: str) -> str:
        import re

        if not re.match(ROLE_KEY_PATTERN, v):
            raise ValueError(
                "key must match pattern: lowercase letters/digits/underscores, "
                "starting with a letter (e.g. 'staff', 'custom_role')"
            )
        return v


class RoleUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None


class RoleOut(BaseModel):
    id: int
    key: str
    display_name: str
    description: Optional[str] = None
    is_active: bool
    is_builtin: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RoleOption(BaseModel):
    """精简版，给前端 Tab/下拉使用。"""
    key: str
    display_name: str
    is_active: bool


class RoleListResponse(BaseModel):
    items: List[RoleOut]
    total: int
