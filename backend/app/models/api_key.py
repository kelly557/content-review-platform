"""API Key model — tenant-scoped service tokens."""
from __future__ import annotations

import secrets
import string
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def _gen_key_plaintext() -> str:
    # 'adr_' 前缀 + 22 位 base62（与前端 mock 一致）
    alphabet = string.ascii_letters + string.digits
    return "adr_" + "".join(secrets.choice(alphabet) for _ in range(22))


def key_prefix(plaintext: str) -> str:
    return plaintext[:16]


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # 仅存前 16 位明文用于列表展示与识别，不存完整明文
    key_prefix: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # sha256 hex of full plaintext — 用于校验但不存明文
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="read")  # read | write
    created_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]
        back_populates="api_keys"
    )
