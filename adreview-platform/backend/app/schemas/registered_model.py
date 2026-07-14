"""Model registry schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.registered_model import (
    LargeModelCategory as _LargeCategory,
    RegisteredModelKind as _Kind,
    RegisteredProviderStatus as _ProviderStatus,
    SmallModelCategory as _Category,
)


class RegisteredModelValidationLog(BaseModel):
    checked_at: datetime
    ok: bool
    http_status: Optional[int] = None
    latency_ms: Optional[int] = None
    message: str


class ArtifactUploadResponse(BaseModel):
    """小模型文件上传后返回的元信息；前端把整段 JSON 存进表单隐藏字段。"""

    storage_key: str
    filename: str
    mime_type: Optional[str] = None
    size: int
    sha256: str


class RegisteredModelVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    model_id: int
    version_no: int
    version_label: Optional[str] = None
    notes: Optional[str] = None
    large_category: Optional[str] = None
    registration_method: str
    provider: Optional[str] = None
    model_name: Optional[str] = None
    endpoint_url: Optional[str] = None
    config: dict[str, Any] = Field(default_factory=dict)
    artifact_storage_key: Optional[str] = None
    artifact_filename: Optional[str] = None
    artifact_mime_type: Optional[str] = None
    artifact_size: Optional[int] = None
    artifact_sha256: Optional[str] = None
    status: str
    validation_log: List[dict] = Field(default_factory=list)
    created_by_id: Optional[int] = None
    created_at: datetime


class RegisteredModelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    code: str
    name: str
    description: Optional[str] = None
    kind: str
    small_category: Optional[str] = None
    large_category: Optional[str] = None
    provider_id: Optional[int] = None
    provider: Optional["RegisteredProviderSummaryOut"] = None
    provider_preset: Optional[str] = None
    model_name: Optional[str] = None
    max_output_tokens: Optional[int] = None
    registration_method: str
    status: str
    version: Optional[str] = None
    config: dict[str, Any] = Field(default_factory=dict)
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    owner_id: Optional[int] = None
    created_by_id: Optional[int] = None
    updated_by_id: Optional[int] = None
    current_version_id: Optional[int] = None
    current_version_no: Optional[int] = None
    current_version: Optional[RegisteredModelVersionOut] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class RegisteredModelListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    code: str
    name: str
    kind: str
    small_category: Optional[str] = None
    large_category: Optional[str] = None
    provider_id: Optional[int] = None
    provider_preset: Optional[str] = None
    provider_label: Optional[str] = None
    model_name: Optional[str] = None
    max_output_tokens: Optional[int] = None
    registration_method: str
    status: str
    version: Optional[str] = None
    current_version_id: Optional[int] = None
    current_version_no: Optional[int] = None
    # 小模型专属：当前版本的 artifact 摘要，用于列表直接展示文件
    artifact_filename: Optional[str] = None
    artifact_size: Optional[int] = None
    artifact_sha256: Optional[str] = None
    owner_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class RegisteredModelCreate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64, description="留空自动生成 mdl_<时间戳>_<4字符>")
    name: str = Field(min_length=1, max_length=128, description="模型展示名")
    description: Optional[str] = Field(default=None, description="模型说明 / 用途 / 注意事项")
    kind: str = Field(
        default="large",
        description="大模型 (large) / 小模型 (small)",
    )
    small_category: Optional[str] = Field(
        default=None,
        max_length=32,
        description=(
            "小模型分类（kind=small 时必填）：politics / terrorism / porn / illicit / "
            "ad / religion / ad_law / abuse / unhealthy"
        ),
    )
    large_category: Optional[str] = Field(
        default=None,
        max_length=16,
        description=(
            "大模型分类（kind=large 时必填）：text / multimodal / other"
        ),
    )
    provider_id: int = Field(
        description="归属 Provider（大模型 / 小模型均必填）；由 /providers 端点创建",
    )
    model_name: Optional[str] = Field(
        default=None,
        max_length=128,
        description="Model ID：厂商返回的模型标识（例：gpt-4o-mini）；必填",
    )
    status: Optional[str] = Field(default=None, description="draft / active / archived")
    version: Optional[str] = Field(default=None, max_length=64, description="语义版本号（可选）")
    config: dict[str, Any] = Field(
        default_factory=dict,
        description="接入配置（protocol、timeout 等），按 provider 自动推断",
    )
    # —— 小模型（传统 ML/深度学习模型）专用字段 ——
    registration_method: Optional[str] = Field(
        default=None,
        description="remote_api (默认) / uploaded_file；不传时由 kind 推断（small→uploaded_file）",
    )
    max_output_tokens: Optional[int] = Field(
        default=None,
        ge=1,
        le=32768,
        description="小模型最大输出 token 数（业务侧推理时控制生成长度）；1 ≤ x ≤ 32768",
    )
    artifact: Optional["ArtifactUploadResponse"] = Field(
        default=None,
        description=(
            "小模型文件元信息（先调 /upload-artifact 拿到 storage_key 再传过来）；"
            "kind=small 时必填"
        ),
    )


class RegisteredModelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    small_category: Optional[str] = None
    large_category: Optional[str] = None
    model_name: Optional[str] = None
    max_output_tokens: Optional[int] = Field(default=None, ge=1, le=32768)
    status: Optional[str] = None
    version: Optional[str] = None
    config: Optional[dict[str, Any]] = None


class RegisteredModelVersionCreate(BaseModel):
    """新建版本时使用的请求体。"""

    version_label: Optional[str] = Field(default=None, max_length=64, description="版本标签（可选，如 1.0.0）")
    notes: Optional[str] = Field(default=None, description="版本说明 / 变更日志")
    large_category: Optional[str] = Field(
        default=None,
        max_length=16,
        description="大模型分类（覆盖 Provider 默认值，可选）",
    )
    model_name: Optional[str] = Field(default=None, max_length=128)
    config: dict[str, Any] = Field(default_factory=dict)
    # —— 小模型文件上传新版本时使用（先调 /upload-artifact 拿到 artifact，再传进来） ——
    artifact: Optional["ArtifactUploadResponse"] = Field(
        default=None,
        description="小模型文件元信息；不传则沿用上一版本的 artifact",
    )


class RegisteredModelValidateResult(BaseModel):
    ok: bool
    log: RegisteredModelValidationLog
    status: str


class ResourceCredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    name: str
    provider: Optional[str] = None
    masked_token: str
    created_by_id: Optional[int] = None
    created_at: datetime


class ResourceCredentialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    provider: Optional[str] = None
    token: str = Field(min_length=1, max_length=2048)
    metadata: dict[str, Any] = Field(default_factory=dict)


# 解决 RegisteredModelCreate / RegisteredModelVersionCreate 中 ArtifactUploadResponse 前向引用
RegisteredModelCreate.model_rebuild()
RegisteredModelVersionCreate.model_rebuild()


# ─── Provider 二级实体 schema ───


class ProviderInitialModel(BaseModel):
    """Provider 创建时一次性提交的模型列表项。

    业务上一个 Provider 通常隶属同一厂商，可能下挂多个 model，例如 openai 下同时
    有 gpt-4o-mini / gpt-4o / o1。一次性提交减少重复填写凭证和接入地址。
    """

    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = Field(default=None, max_length=128, description="模型展示名；留空则取 model_name")
    model_name: str = Field(min_length=1, max_length=128, description="厂商返回的模型标识")
    description: Optional[str] = None
    large_category: str = Field(
        min_length=1,
        max_length=16,
        description="大模型分类（必填）：text / multimodal / other",
    )
    version: Optional[str] = Field(default=None, max_length=64, description="初始语义版本号（可选）")


class RegisteredProviderSummaryOut(BaseModel):
    """嵌在 RegisteredModelOut / 列表项中。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    display_name: str
    provider_preset: Optional[str] = None
    endpoint_url: Optional[str] = None
    masked_token: Optional[str] = None
    status: str


class RegisteredProviderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: Optional[str] = None
    display_name: str
    description: Optional[str] = None
    provider_preset: Optional[str] = None
    endpoint_url: Optional[str] = None
    config: dict[str, Any] = Field(default_factory=dict)
    credential_id: Optional[int] = None
    masked_token: Optional[str] = None
    credential_label: Optional[str] = None
    status: str
    model_count: int = 0
    owner_id: Optional[int] = None
    created_by_id: Optional[int] = None
    updated_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class RegisteredProviderDetailOut(RegisteredProviderOut):
    models: List["RegisteredModelListItem"] = Field(default_factory=list)


class RegisteredProviderCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=128, description="Provider 展示名（业务可读）")
    description: Optional[str] = None
    provider_preset: Optional[str] = Field(
        default=None,
        max_length=64,
        description="openai / anthropic / bailian / deepseek / self-hosted / custom",
    )
    endpoint_url: str = Field(
        min_length=4,
        max_length=2048,
        description="Base URL；自建 / 自定义时需手填",
    )
    api_key: str = Field(
        min_length=1,
        max_length=4096,
        description="API key 原文；服务端加密入库，列表只返 masked 预览",
    )
    initial_models: List["ProviderInitialModel"] = Field(
        default_factory=list,
        description="Provider 下一次性注册的初始 models；可以为空，运营后续补齐",
    )


class RegisteredProviderUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = None
    endpoint_url: Optional[str] = Field(default=None, max_length=2048)
    provider_preset: Optional[str] = Field(default=None, max_length=64)


class RegisteredProviderRotateApiKey(BaseModel):
    api_key: str = Field(min_length=1, max_length=4096)


# Provider → 嵌套 ListItem，前向引用
RegisteredProviderDetailOut.model_rebuild()
