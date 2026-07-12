"""DispositionRule schemas (Phase B).

Step-3 内容被抽到独立资源。CRUD 写权限 admin；mlr / reviewer 只读。
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMBase

VALID_RISK_LEVELS = ("低风险", "中风险", "高风险", "无风险", "敏感")
VALID_SENSITIVE_LEVELS = ("S0", "S1", "S2", "S3")
VALID_ACTIONS = ("approved", "rejected", "desensitize", "review")


class DispositionBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: Optional[str] = None
    is_enabled: bool = False
    risk_levels: List[str] = Field(default_factory=list)
    sensitive_levels: List[str] = Field(default_factory=list)
    review_rule_id: Optional[int] = None
    sample_ratio: Optional[float] = Field(default=100.0, ge=0.0, le=100.0)
    auto_action_overrides: Dict[str, str] = Field(default_factory=dict)

    @field_validator("risk_levels")
    @classmethod
    def _v_risks(cls, v: List[str]) -> List[str]:
        for x in v:
            if x not in VALID_RISK_LEVELS:
                raise ValueError(f"risk_levels 含非法值: {x}")
        return list(v)

    @field_validator("sensitive_levels")
    @classmethod
    def _v_sens(cls, v: List[str]) -> List[str]:
        for x in v:
            if x not in VALID_SENSITIVE_LEVELS:
                raise ValueError(f"sensitive_levels 含非法值: {x}")
        return list(v)

    @field_validator("auto_action_overrides")
    @classmethod
    def _v_actions(cls, v: Dict[str, str]) -> Dict[str, str]:
        for k, val in v.items():
            if val not in VALID_ACTIONS:
                raise ValueError(f"auto_action_overrides.{k} 动作非法: {val}")
        return dict(v)


class DispositionCreate(DispositionBase):
    code: Optional[str] = Field(default=None, min_length=1, max_length=64)


class DispositionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    is_enabled: Optional[bool] = None
    risk_levels: Optional[List[str]] = None
    sensitive_levels: Optional[List[str]] = None
    review_rule_id: Optional[int] = None
    sample_ratio: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    auto_action_overrides: Optional[Dict[str, str]] = None


class DispositionOut(ORMBase):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    is_enabled: bool
    risk_levels: List[str]
    sensitive_levels: List[str]
    review_rule_id: Optional[int] = None
    sample_ratio: Optional[float] = None
    auto_action_overrides: Dict[str, str]
    is_builtin: bool
    is_editable: bool
    strategy_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None


class DispositionDuplicateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=128)
