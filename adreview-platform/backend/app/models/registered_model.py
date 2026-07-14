"""Model registry — independent ORM for the resources/models domain."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any, Optional

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


class RegisteredModelStatus(str, enum.Enum):
    DRAFT = "draft"
    VALIDATING = "validating"
    ACTIVE = "active"
    INACTIVE = "inactive"
    FAILED = "failed"
    ARCHIVED = "archived"


class RegisteredModelRegistrationMethod(str, enum.Enum):
    REMOTE_API = "remote_api"
    UPLOADED_FILE = "uploaded_file"  # 小模型：上传文件（传统 ML/深度学习模型权重）


class RegisteredModelKind(str, enum.Enum):
    """大模型 / 小模型 — 添加模型时必须选择。"""

    LARGE = "large"
    SMALL = "small"


class SmallModelCategory(str, enum.Enum):
    """小模型分类 — 固定枚举，必须选择其一。

    业务上每个小模型挂在一个固定分类下（涉政/涉恐/...），与 LLM 风格
    的多分类分类器不同；分类是模型本身的目标域，不是它能处理的范围。
    """

    POLITICS = "politics"          # 涉政
    TERRORISM = "terrorism"        # 涉恐
    PORN = "porn"                  # 涉黄
    ILLICIT = "illicit"            # 违禁
    AD = "ad"                      # 广告
    RELIGION = "religion"          # 宗教
    AD_LAW = "ad_law"              # 广告法
    ABUSE = "abuse"                # 辱骂
    UNHEALTHY = "unhealthy"        # 不良


class RegisteredModelVersionStatus(str, enum.Enum):
    """版本状态：草稿/已校验/已启用/已停用/已归档。"""

    DRAFT = "draft"
    VALIDATED = "validated"
    ACTIVE = "active"
    INACTIVE = "inactive"
    FAILED = "failed"
    ARCHIVED = "archived"


class RegisteredModel(Base):
    __tablename__ = "registered_models"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, default=lambda: str(uuid.uuid4())
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 大模型 / 小模型
    kind: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    # 小模型分类（kind=small 时必填；kind=large 时为 null）
    small_category: Mapped[Optional[str]] = mapped_column(
        String(32), nullable=True, index=True
    )
    provider: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    model_name: Mapped[Optional[str]] = mapped_column(
        "model", String(128), nullable=True, index=True
    )
    # 小模型专用：最大输出 token 数（业务侧推理时控制生成长度）
    max_output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    registration_method: Mapped[str] = mapped_column(
        String(16),
        default=RegisteredModelRegistrationMethod.REMOTE_API.value,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(16),
        default=RegisteredModelStatus.DRAFT.value,
        nullable=False,
        index=True,
    )
    version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    endpoint_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[Any] = mapped_column(JSONB, default=dict, nullable=False)
    # 历史遗留字段（dev DB 实际保留的列，对齐 schema 用；后续迁移脚本会清理）
    modalities: Mapped[Any] = mapped_column(
        JSONB, default=list, server_default="[]", nullable=False
    )
    scale_class: Mapped[str] = mapped_column(
        String(8), default="large", server_default="large", nullable=False
    )
    category: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    credential_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("resource_credentials.id", ondelete="SET NULL"), nullable=True
    )
    current_version_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("registered_model_versions.id", use_alter=True, ondelete="SET NULL"),
        nullable=True,
    )
    owner_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True
    )

    versions = relationship(
        "RegisteredModelVersion",
        back_populates="model",
        cascade="all, delete-orphan",
        foreign_keys="RegisteredModelVersion.model_id",
        order_by="RegisteredModelVersion.version_no",
    )
    current_version = relationship(
        "RegisteredModelVersion",
        foreign_keys=[current_version_id],
        post_update=True,
        uselist=False,
    )
    credential = relationship("ResourceCredential", foreign_keys=[credential_id])

    __table_args__ = (
        Index("ix_registered_models_kind_category", "kind", "small_category"),
    )


class RegisteredModelVersion(Base):
    __tablename__ = "registered_model_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, default=lambda: str(uuid.uuid4())
    )
    model_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("registered_models.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # 版本标签（如 "1.0.0"）；可空，默认为 vN
    version_label: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    registration_method: Mapped[str] = mapped_column(String(16), nullable=False)
    provider: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    model_name: Mapped[Optional[str]] = mapped_column(
        "model", String(128), nullable=True
    )
    endpoint_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[Any] = mapped_column(JSONB, default=dict, nullable=False)
    credential_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("resource_credentials.id", ondelete="SET NULL"), nullable=True
    )
    artifact_storage_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    artifact_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    artifact_mime_type: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    artifact_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    artifact_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=RegisteredModelVersionStatus.DRAFT.value,
    )
    validation_log: Mapped[Any] = mapped_column(JSONB, default=list, nullable=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    model = relationship(
        "RegisteredModel",
        back_populates="versions",
        foreign_keys=[model_id],
    )

    __table_args__ = (
        UniqueConstraint("model_id", "version_no", name="uq_registered_model_version"),
    )


class ResourceCredential(Base):
    """Encrypted credential for outbound model API calls.

    Token is stored encrypted (Fernet, AES-GCM under the hood). API responses
    only ever return a masked preview; audit events never write the plaintext.
    """

    __tablename__ = "resource_credentials"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(128))
    provider: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    masked_token: Mapped[str] = mapped_column(String(64), nullable=False)
    metadata_json: Mapped[Any] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
