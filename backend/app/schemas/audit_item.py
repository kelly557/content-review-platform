"""AuditItem schemas."""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import ORMBase


class LinkedLibraryOut(BaseModel):
    """Single library attached to an audit item."""

    library_id: int
    library_type: str
    code: str
    name: str
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    sort_order: int = 0


class ActiveModelVersionOut(BaseModel):
    """当前生效的小模型版本摘要 — 仅 is_builtin=true 时有值。"""

    version_id: int
    model_id: int
    model_code: str
    model_name: str
    version_no: int
    version_label: Optional[str] = None


class ActiveLargeModelOut(BaseModel):
    """个性化规则生效大模型摘要 — 仅 is_builtin=false 时有值。"""

    model_id: int
    model_code: str
    model_name: str


class AuditItemOut(ORMBase):
    id: int
    package_code: str
    code: str
    name_cn: str
    small_category: Optional[str] = None
    aliases: list[Any] = Field(default_factory=list)
    description: Optional[str] = None
    sort_order: int = 0
    is_enabled: bool = True
    is_builtin: bool = False
    point_count: int = 0
    # N:M 关联：审核项 ↔ 自定义图库/词库
    linked_libraries: list[LinkedLibraryOut] = Field(default_factory=list)
    # 通用规则: 生效小模型版本 (NULL = 未指定)
    active_small_model_version_id: Optional[int] = None
    active_model_version: Optional[ActiveModelVersionOut] = None
    # 个性化规则: 生效大模型 (NULL = 未指定)
    active_large_model_id: Optional[int] = None
    active_large_model: Optional[ActiveLargeModelOut] = None
    # 个性化规则: 关联知识文档 ID 列表 (NULL/[] = 未关联)
    knowledge_document_ids: list[int] = Field(default_factory=list)
    # 「审核 Agent」共享阈值(仅 is_builtin=false 的自定义 item)
    low_threshold_min: Optional[float] = None
    medium_threshold_min: Optional[float] = None
    high_threshold_min: Optional[float] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class AuditItemCreate(BaseModel):
    """写入 schema — is_builtin 不暴露，由服务端强制为 False。"""

    model_config = ConfigDict(extra="forbid")

    name_cn: str = Field(min_length=1, max_length=64)
    aliases: list[Any] = Field(default_factory=list)
    description: Optional[str] = None
    sort_order: int = 0
    is_enabled: bool = True
    # PATCH semantics: None=不动；[]=清空；[非空]=全量替换
    linked_library_ids: Optional[list[int]] = None
    # 仅个性化可写
    knowledge_document_ids: Optional[list[int]] = None


class AuditItemUpdate(BaseModel):
    """写入 schema — 互斥校验在 service 层做。

    内置（is_builtin=True）规则允许修改 is_enabled / description /
    linked_library_ids / active_small_model_version_id；其他字段在
    service 层 422 拦截。个性化规则可改上述 + name_cn / sort_order /
    aliases / knowledge_document_ids / 3 档共享阈值。
    """

    model_config = ConfigDict(extra="forbid")

    name_cn: Optional[str] = Field(default=None, min_length=1, max_length=64)
    aliases: Optional[list[Any]] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_enabled: Optional[bool] = None
    linked_library_ids: Optional[list[int]] = None
    # 通用规则「切换生效小模型版本」
    active_small_model_version_id: Optional[int] = None
    # 个性化规则「切换生效大模型」
    active_large_model_id: Optional[int] = None
    # 个性化规则「关联知识文档」（多选；None=不动，[]=清空，[非空]=替换）
    knowledge_document_ids: Optional[list[int]] = None
    # 「审核 Agent」共享阈值(仅 is_builtin=false 的个性化 item)
    # 业务规则与 audit_point 一致(2026-07-29):
    #   low_min ≤ medium_min - 0.01
    #   medium_min ≤ high_min - 0.01
    #   high_min ≤ 100
    low_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    medium_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    high_threshold_min: Optional[float] = Field(default=None, ge=0.0, le=100.0)

    @model_validator(mode="after")
    def _check_threshold_order(self):
        """审核 Agent 共享阈值一致性(2026-07-29 业务规则)。

        不存 max 列,只存 3 个 min;校验"反推间隔 0.01 + 上限 100"。
        缺一不强制,仅在同时给出时校验跨档关系。
        """
        lo = self.low_threshold_min
        med = self.medium_threshold_min
        hi = self.high_threshold_min
        if lo is not None and med is not None and lo + 0.01 - med > 1e-6:
            raise ValueError(
                f"低风险分下限 ({lo}) + 0.01 必须 ≤ 中风险分下限 ({med})"
            )
        if med is not None and hi is not None and med + 0.01 - hi > 1e-6:
            raise ValueError(
                f"中风险分下限 ({med}) + 0.01 必须 ≤ 高风险分下限 ({hi})"
            )
        return self


class ItemSuggestion(BaseModel):
    item_id: int
    item_code: str
    item_name_cn: str
    score: float
    matched_aliases: list[str] = Field(default_factory=list)
    matched_terms: list[str] = Field(default_factory=list)


class SuggestResponse(BaseModel):
    matches: list[ItemSuggestion] = Field(default_factory=list)
    mock: bool = True
    engine: str = "mock-v1"