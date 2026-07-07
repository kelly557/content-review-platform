"""Desensitization rule model.

Per-tenant rule for masking PII / sensitive spans in machine-review hits.

Categories:
- id_card   : 身份证号
- phone     : 手机号
- bank_card : 银行卡号
- email     : 邮箱
- address   : 地址（关键词 + 正则）
- custom    : 自定义敏感词（整词替换）
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DesensitizeCategory(str, enum.Enum):
    ID_CARD = "id_card"
    PHONE = "phone"
    BANK_CARD = "bank_card"
    EMAIL = "email"
    ADDRESS = "address"
    CUSTOM = "custom"


class DesensitizationRule(Base):
    __tablename__ = "desensitization_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    pattern: Mapped[str] = mapped_column(Text, nullable=False)
    mask_template: Mapped[str] = mapped_column(String(64), nullable=False, default="****")
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Optional tenancy hook — kept as a free-form service code so existing
    # schemas don't have to drag in a Tenant model. Nullable = global rule.
    service_code: Mapped[Optional[str]] = mapped_column(
        String(64), ForeignKey("services.code"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )