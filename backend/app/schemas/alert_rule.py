"""Alert rule schemas — 异常规则配置（对齐前端 anomalyThresholds）."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

from app.schemas.common import ORMBase


class ThresholdPart(BaseModel):
    operator: str
    value: float
    unit: str  # '%' | 'count'


class ExtraCondition(BaseModel):
    field: str
    operator: str
    value: float


class AlertRuleOut(ORMBase):
    id: int
    rule_code: str
    label: str
    metric: str
    dimension: str
    algorithm: str
    window_label: str
    critical: Optional[ThresholdPart] = None
    warn: Optional[ThresholdPart] = None
    extra_conditions: Optional[List[ExtraCondition]] = None
    description: Optional[str] = None
    enabled: bool
    source: str
    updated_at: Optional[datetime] = None


class AlertRuleUpdate(BaseModel):
    label: Optional[str] = None
    critical: Optional[ThresholdPart] = None
    warn: Optional[ThresholdPart] = None
    extra_conditions: Optional[List[ExtraCondition]] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None


class AlertRuleCreate(AlertRuleUpdate):
    rule_code: str
    label: str
    metric: str
    dimension: Optional[str] = "全局"
    algorithm: Optional[str] = "固定阈值"
    window_label: Optional[str] = "近 1 小时"
    source: Optional[str] = "custom"
