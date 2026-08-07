"""Role-permission model — menu/feature permission matrix per role.

权限矩阵存储: role_key (对应 UserRole enum value 或自定义 role key) × menu_key
(前端 menuTree.ts 中的 key) × permissions (JSONB 数组 ['view','edit','delete'])。

MVP 阶段只做存取回显; 真正的菜单强制过滤留后续阶段。
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class RolePermission(Base):
    __tablename__ = "role_permissions"
    # role_key + menu_key 联合唯一
    role_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    menu_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    permissions: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True, default=list
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
