"""Strategy schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.strategy import StrategyScope
from app.schemas.common import ORMBase


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
