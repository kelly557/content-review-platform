"""Tenant model — multi-tenant isolation for API keys & users."""
from __future__ import annotations

import secrets
import string
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def _gen_tenant_public_id() -> str:
    # 'tnt_' 前缀 + 随机串（与前端 mock 格式一致，便于人读）
    alphabet = string.ascii_lowercase + string.digits
    return "tnt_" + "".join(secrets.choice(alphabet) for _ in range(10))


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=_gen_tenant_public_id
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    api_keys: Mapped[List["ApiKey"]] = relationship(  # type: ignore[name-defined]
        back_populates="tenant", cascade="all, delete-orphan"
    )
