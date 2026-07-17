"""UploadedDocument: 用户上传到「自定义规则 Agent」的源文件。

一个 AuditItem（个性化审核项）下可关联多个 UploadedDocument。
每个文件被解析后产生若干 AuditPoint，通过 ``audit_points.source_document_id``
回溯到本表，方便「全生命周期」展示与重新解析。

解析方式：

- ``structured``（.xlsx/.csv）：直接按列映射导入审核点，无 LLM 调用。
- ``llm``（.pdf/.docx/.txt/.md）：调用 MaaS 大模型提取审核点；Prompt 可定制。
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UploadedDocKind(str, enum.Enum):
    """文件类型，决定解析方式。"""

    STRUCTURED = "structured"  # .xlsx/.csv — 直接列映射导入
    LLM = "llm"  # .pdf/.docx/.txt/.md — LLM 提取


class UploadedDocStatus(str, enum.Enum):
    """文件生命周期状态。"""

    PENDING = "pending"  # 已上传，等待调度
    PARSING = "parsing"  # 解析中
    PARSED = "parsed"  # 解析成功
    FAILED = "failed"  # 解析失败（可手动重试）


class UploadedDocument(Base):
    __tablename__ = "uploaded_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 关联的 AuditItem (个性化审核项)
    item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("audit_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 冗余 package_code 便于查询与权限校验
    package_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # 原始文件名（用于前端展示与下载）
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # 文件分类：structured | llm — 必须与 alembic migration 中的 enum type 名称一致 (uploadeddoc_kind)
    kind: Mapped[UploadedDocKind] = mapped_column(
        Enum(
            UploadedDocKind,
            name="uploadeddoc_kind",
            native_enum=True,
            create_constraint=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    # 存储 key （相对于 storage_root）
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    # 文件大小 (bytes)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # sha256
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # MIME
    mime_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # 状态 — 必须与 alembic migration 中的 enum type 名称一致 (uploadeddoc_status)
    status: Mapped[UploadedDocStatus] = mapped_column(
        Enum(
            UploadedDocStatus,
            name="uploadeddoc_status",
            native_enum=True,
            create_constraint=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=UploadedDocStatus.PENDING,
        nullable=False,
        index=True,
    )
    # 解析出的审核点数量
    parsed_point_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 解析失败时的错误信息
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 解析完成时间
    parsed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True
    )
    # 用户自定义 Prompt (Markdown)。仅 kind=llm 有效。
    prompt_markdown: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 创建者
    created_by: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), onupdate=func.now(), nullable=True
    )

    __table_args__ = (
        Index("ix_uploaded_documents_item_status", "item_id", "status"),
    )