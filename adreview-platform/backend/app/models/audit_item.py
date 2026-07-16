"""AuditItem: 审核项. Mid-level grouping under a rule package (Service).

Each rule package (Service) owns a set of audit items (e.g. 涉政, 暴恐).
An item groups multiple audit points (fine-grained detection configs) and
carries natural-language aliases for the suggest API.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id

if TYPE_CHECKING:
    from app.models.audit_item_library import AuditItemLibrary
    from app.models.library import Library


class AuditItem(Base):
    __tablename__ = "audit_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    package_code: Mapped[str] = mapped_column(
        String(64), ForeignKey("services.code"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name_cn: Mapped[str] = mapped_column(String(64), nullable=False)
    # 审核项对应的小模型分类（与小模型 small_category 枚举对齐）。
    # NULL = 该 item 不需要小模型（如专项/水印/引流）。
    small_category: Mapped[Optional[str]] = mapped_column(
        String(32), nullable=True, index=True
    )
    aliases: Mapped[list[Any]] = mapped_column(
        JSONB(astext_type=Text()),
        nullable=False,
        default=list,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    # 通用规则「生效小模型版本」指针：仅 is_builtin=true 时写入；FK 到
    # registered_model_versions.id。version 删除时 SET NULL（前端显示「未指定」）。
    active_small_model_version_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("registered_model_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 个性化规则「生效大模型」指针：仅 is_builtin=false 时写入；
    # 指向 kind='large' 的 RegisteredModel（LLM，prompt 执行器）。
    active_large_model_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("registered_models.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 个性化规则「关联知识文档」ID 列表（多选）。JSONB 存 list[int]。
    # 仅 is_builtin=false 时写入；通用规则不接受该字段。
    knowledge_document_ids: Mapped[Optional[list[int]]] = mapped_column(
        JSONB, nullable=True, default=list
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    # ─── N:M 关联：审核项 ↔ 库（同一 item 下的库必须共享单一 library_type） ───
    linked_libraries: Mapped[list["Library"]] = relationship(
        "Library",
        secondary="audit_item_libraries",
        lazy="selectin",
        order_by="Library.id",
        overlaps="back_audit_items",
    )
    linked_library_links: Mapped[list["AuditItemLibrary"]] = relationship(
        "AuditItemLibrary",
        cascade="all, delete-orphan",
        lazy="selectin",
        overlaps="linked_libraries",
    )

    __table_args__ = (
        UniqueConstraint("package_code", "code", name="uq_audit_item_pkg_code"),
    )