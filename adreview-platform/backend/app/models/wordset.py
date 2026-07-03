"""Custom text wordset model.

A WordSet is a named list of sensitive/forbidden words (黑名单) or
allow-listed words (白名单). Strategies reference these by code.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, Enum, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, TypeDecorator

from app.db.session import Base


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class WordSetGroup(str, enum.Enum):
    """业务分组：内容主题/行业/法规等横向分类。"""

    SENSITIVE = "敏感词"
    AD = "广告法"
    BRAND = "品牌"
    INDUSTRY = "行业"
    COMPLIANCE = "合规"
    KEYWORD = "关键词"
    INVENTORY = "清单"
    CUSTOM = "自定义"


class WordSetAction(str, enum.Enum):
    """处置行为：决定命中数据集后系统如何响应。"""

    BLOCK = "黑名单"   # 命中 → 拒绝
    ALLOW = "白名单"   # 命中 → 强制放行
    REVIEW = "需复审"  # 命中 → 进入人工复审
    TAG = "标签"       # 命中 → 仅打标，不决策


# 保留旧枚举做向后兼容：迁移期老数据用 kind，新数据用 group+action
class WordSetKind(str, enum.Enum):
    BLACKLIST = "黑名单"
    WHITELIST = "白名单"


class WordSet(Base):
    __tablename__ = "word_sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # 新两轴：业务分组 + 处置行为
    group: Mapped[WordSetGroup] = mapped_column(
        Enum(WordSetGroup), default=WordSetGroup.KEYWORD, nullable=False, index=True
    )
    action: Mapped[WordSetAction] = mapped_column(
        Enum(WordSetAction), default=WordSetAction.BLOCK, nullable=False, index=True
    )
    # 旧 kind 字段保留，迁移后写为新值；nullable=True 兼容老数据
    kind: Mapped[Optional[WordSetKind]] = mapped_column(
        Enum(WordSetKind), nullable=True, index=True
    )
    words_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ignored_services: Mapped[Any] = mapped_column(
        _JSONType, default=list, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    __table_args__ = (
        Index("ix_word_sets_group_action", "group", "action"),
        Index("ix_word_sets_action_active", "action", "is_active"),
    )
