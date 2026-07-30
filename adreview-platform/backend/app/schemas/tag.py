"""Tag management schemas — 三级级联标签体系 CRUD + tree 输出。

P0: 保留所有字段（domain/category/jurisdictions/...）用于扁平过滤。
P2: 新增 parent_id / level / bound_model_id / bound_model_kind + TreeNode。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.tag import (
    TAG_LEVEL_LEAF,
    TAG_LEVEL_MID,
    TAG_LEVEL_TOP,
    VALID_TAG_LEVELS,
    TagCategory,
    TagDomain,
    TagStatus,
)
from app.schemas.common import ORMBase


class TagBase(BaseModel):
    code: str = Field(min_length=1, max_length=96)
    name: str = Field(min_length=1, max_length=128)
    name_en: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    domain: TagDomain
    category: TagCategory
    jurisdictions: List[str] = Field(default_factory=list)
    industries: List[str] = Field(default_factory=list)
    channels: List[str] = Field(default_factory=list)
    knowledge_refs: List[str] = Field(default_factory=list)
    evidence_refs: List[str] = Field(default_factory=list)
    status: TagStatus = TagStatus.DRAFT

    # ── 三级级联字段 ──
    level: int = Field(default=TAG_LEVEL_TOP, ge=TAG_LEVEL_TOP, le=TAG_LEVEL_LEAF)
    parent_id: Optional[str] = Field(default=None, max_length=36)
    bound_model_id: Optional[int] = Field(default=None, ge=1)
    bound_model_kind: Optional[str] = Field(default=None, max_length=8)

    @field_validator("jurisdictions", "industries", "channels")
    @classmethod
    def _strip_blanks(cls, v: List[str]) -> List[str]:
        return [s.strip() for s in v if s and s.strip()]

    @field_validator("level")
    @classmethod
    def _validate_level(cls, v: int) -> int:
        if v not in VALID_TAG_LEVELS:
            raise ValueError(f"level 必须是 1/2/3，收到 {v}")
        return v

    @field_validator("bound_model_kind")
    @classmethod
    def _validate_bound_model_kind(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.lower()
        if v not in {"large", "small"}:
            raise ValueError("bound_model_kind 必须是 large 或 small")
        return v


class TagCreate(TagBase):
    """新建标签 body。

    业务约束（service 层校验）：
      - level=1 时 parent_id 必须为 null
      - level>1 时 parent_id 必填，且 parent.level = level-1
      - level=3 时 bound_model_id 必填
      - level<3 时 bound_model_id 必须为 null
    """


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    name_en: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    domain: Optional[TagDomain] = None
    category: Optional[TagCategory] = None
    jurisdictions: Optional[List[str]] = None
    industries: Optional[List[str]] = None
    channels: Optional[List[str]] = None
    knowledge_refs: Optional[List[str]] = None
    evidence_refs: Optional[List[str]] = None
    status: Optional[TagStatus] = None
    # level/parent_id 一旦创建不允许改（防循环），如需调整请删除重建
    bound_model_id: Optional[int] = Field(default=None, ge=1)
    bound_model_kind: Optional[str] = Field(default=None, max_length=8)

    @field_validator("bound_model_kind")
    @classmethod
    def _validate_bound_model_kind(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.lower()
        if v not in {"large", "small"}:
            raise ValueError("bound_model_kind 必须是 large 或 small")
        return v


class TagOut(ORMBase):
    id: str
    code: str
    name: str
    name_en: Optional[str]
    description: Optional[str]
    domain: TagDomain
    category: TagCategory
    jurisdictions: List[str]
    industries: List[str]
    channels: List[str]
    knowledge_refs: List[str]
    evidence_refs: List[str]
    status: TagStatus
    version: int
    level: int
    parent_id: Optional[str]
    bound_model_id: Optional[int]
    bound_model_kind: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]


class TagSummary(BaseModel):
    """Lightweight projection used by list pages."""

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)

    id: str
    code: str
    name: str
    name_en: Optional[str]
    domain: TagDomain
    category: TagCategory
    jurisdictions: List[str]
    industries: List[str]
    channels: List[str]
    status: TagStatus
    level: int
    parent_id: Optional[str]
    bound_model_id: Optional[int]
    bound_model_kind: Optional[str]
    updated_at: Optional[datetime]


class TagTreeNode(BaseModel):
    """树节点 — 用于 /tags/tree 接口和前端 Cascader/Tree 渲染。"""

    id: str
    name: str
    code: str
    level: int
    status: TagStatus
    domain: TagDomain
    bound_model_id: Optional[int] = None
    bound_model_kind: Optional[str] = None
    bound_model_label: Optional[str] = None  # 拼接好的模型显示名（id + name），前端直接渲染
    children: List["TagTreeNode"] = Field(default_factory=list)


class TagReferenceItem(BaseModel):
    """小模型详情页「引用标签」chip — 含完整路径。"""

    id: str
    name: str
    path: str  # 例：涉政 / 一号领导 / 漫画
    level: int


class TagReferenceList(BaseModel):
    """GET /tags/references?model_id=X 反查结果。"""

    model_id: int
    total: int
    items: List[TagReferenceItem]


# 前向引用解析（递归 Pydantic 模型）
TagTreeNode.model_rebuild()