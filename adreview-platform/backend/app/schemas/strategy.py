"""Strategy schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.strategy import StrategyScope
from app.schemas.common import ORMBase

VALID_RISK_LEVELS = ("低风险", "中风险", "高风险", "零容忍")


class HumanReviewSettings(BaseModel):
    """策略级别的人工审核配置，存入 strategy.definition.human_review JSONB。"""

    is_enabled: bool = False
    risk_levels: List[str] = Field(default_factory=list)
    review_rule_id: Optional[int] = None

    def normalized(self) -> "HumanReviewSettings":
        """清理后返回：仅保留合法 risk_levels，无意义字段置空。"""
        levels = [l for l in self.risk_levels if l in VALID_RISK_LEVELS]
        if not self.is_enabled:
            return HumanReviewSettings(is_enabled=False, risk_levels=[], review_rule_id=None)
        return HumanReviewSettings(
            is_enabled=True, risk_levels=levels, review_rule_id=self.review_rule_id
        )


class StrategyItemRef(BaseModel):
    media_type: str = Field(min_length=1, max_length=16)
    item_id: int
    is_enabled: bool = True


class StrategyOut(ORMBase):
    id: int
    code: str
    name: str
    scope: StrategyScope
    description: Optional[str]
    is_active: bool
    priority: int
    effective_from: Optional[datetime]
    effective_until: Optional[datetime]
    definition: Dict[str, Any] = Field(default_factory=dict)
    service_config: Dict[str, Any] = Field(default_factory=dict)
    enabled_items: List[StrategyItemRef] = Field(default_factory=list)
    created_at: datetime
    updated_at: Optional[datetime]


class StrategyCreate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    scope: StrategyScope = StrategyScope.GENERAL
    description: Optional[str] = None
    is_active: bool = True
    priority: int = Field(default=1, ge=0, le=10)
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    services: List[str] = Field(default_factory=list)
    enabled_items: List[StrategyItemRef] = Field(default_factory=list)
    definition: Dict[str, Any] = Field(default_factory=dict)
    service_config: Dict[str, Any] = Field(default_factory=dict)


class StrategyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    priority: Optional[int] = Field(default=None, ge=0, le=10)
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    services: Optional[List[str]] = None
    enabled_items: Optional[List[StrategyItemRef]] = None
    definition: Optional[Dict[str, Any]] = None
    service_config: Optional[Dict[str, Any]] = None


class StrategyDuplicateRequest(BaseModel):
    name: Optional[str] = None


class StrategyValidateResult(BaseModel):
    ok: bool
    warnings: List[str] = Field(default_factory=list)
    checked_at: datetime
