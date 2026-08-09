"""Tag management model — 三级级联标签体系。

P0+P2 scope:
  - P0: Tag 记录本身仍是核心持久化实体，hit-engine 表已清理。
  - P2: 支持 3 级级联 (level=1/2/3) + 自引用 parent_id + 三级标签绑定模型
        (bound_model_id, bound_model_kind)。模型删除时 FK ON DELETE SET NULL
        自动清理引用，不会阻断模型删除。
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, TypeDecorator

from app.db.session import Base


class _JSONType(TypeDecorator):
    """JSONB on Postgres, JSON on SQLite (test)."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        from sqlalchemy.dialects.postgresql import JSONB

        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class TagDomain(str, enum.Enum):
    POLITICS = "politics"
    PORN = "porn"
    VIOLENCE = "violence"
    ADS_LAW = "ads_law"
    MEDICAL = "medical"
    FINANCE = "finance"
    MINOR = "minor"
    PRIVACY = "privacy"
    IP = "ip"
    GAMBLING = "gambling"
    FRAUD = "fraud"
    CUSTOM = "custom"


class TagCategory(str, enum.Enum):
    FIGURE = "figure"
    EVENT = "event"
    ORGANIZATION = "organization"
    SYMBOL = "symbol"
    CLAIM = "claim"
    SLOGAN = "slogan"
    SCENE = "scene"
    PRODUCT = "product"
    PRICE = "price"
    ABSOLUTE_TERM = "absolute_term"
    CREDENTIAL = "credential"
    CUSTOM = "custom"


class TagStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    DEPRECATED = "deprecated"


# 标签层级常量（与前端 Drawer 逻辑一致）
TAG_LEVEL_TOP = 1     # 顶级（一级）
TAG_LEVEL_MID = 2     # 中间级（二级）
TAG_LEVEL_LEAF = 3    # 叶子级（三级，必绑模型）

VALID_TAG_LEVELS = (TAG_LEVEL_TOP, TAG_LEVEL_MID, TAG_LEVEL_LEAF)

# 适用模态（仅三级标签使用；一/二级为 NULL 表示跨模态共享节点）
VALID_TAG_MODALITIES = ("text", "image", "audio", "video")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    code: Mapped[str] = mapped_column(String(96), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    name_en: Mapped[Optional[str]] = mapped_column(String(128))
    description: Mapped[Optional[str]] = mapped_column(Text)

    domain: Mapped[TagDomain] = mapped_column(Enum(TagDomain), nullable=False, index=True)
    category: Mapped[TagCategory] = mapped_column(Enum(TagCategory), nullable=False, index=True)
    jurisdictions: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)
    industries: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)
    channels: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)

    knowledge_refs: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)
    evidence_refs: Mapped[List[str]] = mapped_column(_JSONType, default=list, nullable=False)

    status: Mapped[TagStatus] = mapped_column(
        Enum(TagStatus), default=TagStatus.DRAFT, nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # ── 三级级联字段 ────────────────────────────────────────────────
    level: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=TAG_LEVEL_TOP,
        server_default=str(TAG_LEVEL_TOP),
        index=True,
    )
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("tags.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    parent = relationship(
        "Tag",
        remote_side="Tag.id",
        backref="children",
        foreign_keys=[parent_id],
    )
    # 反向：哪些 library 绑定了本标签 (level 1/2 才允许被 library 绑定)
    # 与 Library.tags 同样用 viewonly;反向查询走 LibraryTag 关联对象。
    libraries: Mapped[list["Library"]] = relationship(
        "Library",
        secondary="library_tags",
        viewonly=True,
    )

    # 适用模态（仅 level=3 有意义；level<3 必须为 NULL）
    modality: Mapped[Optional[str]] = mapped_column(
        String(8), nullable=True, index=True
    )  # 'text'|'image'|'audio'|'video'|null

    # 三级标签绑定模型（FK → registered_models.id, ON DELETE SET NULL）
    # 只有 level=3 才允许设置；业务校验放在 service 层
    bound_model_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("registered_models.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    bound_model_kind: Mapped[Optional[str]] = mapped_column(
        String(8), nullable=True
    )  # 'large'|'small'|null — 冗余便于过滤

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True, index=True
    )

    __table_args__ = (
        Index("ix_tag_domain_category", "domain", "category"),
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    @property
    def path(self) -> str:
        """顶级→自身的完整路径字符串（仅在已加载 parent 链时有效）。"""
        names: list[str] = []
        node: Optional["Tag"] = self
        while node is not None:
            names.append(node.name)
            node = node.parent
        return "/".join(reversed(names))