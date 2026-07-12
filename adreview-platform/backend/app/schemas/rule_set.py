"""RuleSet / StrategyPointV2 schemas (Phase B).

PR B2：仅暴露 CRUD 给 admin。mlr / reviewer 只读。
PR B3 才在 strategies 创建路径上 force 写入；目前保持可选。
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMBase


VALID_MEDIA_TYPES = ("image", "text", "audio", "doc", "video")


class StrategyPointV2Ref(BaseModel):
    """RuleSet 用的审核点 ref（含阈值 / 关联库 override）。"""

    media_type: str = Field(min_length=1, max_length=16)
    item_id: int
    point_id: int
    is_enabled: bool = True
    medium_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    high_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    linked_library_ids: Optional[List[int]] = None


class RuleSetBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: Optional[str] = None
    config: dict = Field(default_factory=dict)
    points: List[StrategyPointV2Ref] = Field(default_factory=list)


class RuleSetCreate(RuleSetBase):
    code: Optional[str] = Field(default=None, min_length=1, max_length=64)


class RuleSetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    config: Optional[dict] = None
    points: Optional[List[StrategyPointV2Ref]] = None


class RuleSetOut(ORMBase):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    config: dict
    is_builtin: bool
    is_editable: bool
    point_count: int = 0
    enabled_point_count: int = 0
    strategy_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class RuleSetDetailOut(RuleSetOut):
    points: List[StrategyPointV2Ref] = Field(default_factory=list)


class RuleSetDuplicateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=128)
