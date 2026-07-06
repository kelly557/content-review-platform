"""AuditPoint schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.models.audit_point import AuditPointRisk
from app.schemas.common import ORMBase


class AuditPointOut(ORMBase):
    id: int
    package_code: str
    item_id: int
    code: str
    label: str
    label_cn: str
    description: Optional[str] = None
    medium_threshold: float
    high_threshold: float
    scope_text: Optional[str] = None
    risk_level: AuditPointRisk = AuditPointRisk.MEDIUM
    is_enabled: bool
    custom_wordset_id: Optional[int] = None
    sort_order: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None


class AuditPointCreate(BaseModel):
    item_id: int
    code: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=128)
    label_cn: str = Field(min_length=1, max_length=64)
    description: Optional[str] = None
    medium_threshold: float = Field(default=60.0, ge=0, le=100)
    high_threshold: float = Field(default=90.0, ge=0, le=100)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    risk_level: AuditPointRisk = AuditPointRisk.MEDIUM
    is_enabled: bool = False
    custom_wordset_id: Optional[int] = None
    sort_order: int = 0

    @model_validator(mode="after")
    def _check_order(self):
        if self.medium_threshold >= self.high_threshold:
            raise ValueError("中风险分必须 < 高风险分")
        return self


class AuditPointUpdate(BaseModel):
    label_cn: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = None
    medium_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    high_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    risk_level: Optional[AuditPointRisk] = None
    is_enabled: Optional[bool] = None
    custom_wordset_id: Optional[int] = None
    sort_order: Optional[int] = None

    @model_validator(mode="after")
    def _check_order(self):
        if (
            self.medium_threshold is not None
            and self.high_threshold is not None
            and self.medium_threshold >= self.high_threshold
        ):
            raise ValueError("中风险分必须 < 高风险分")
        return self


class AuditPointResetResult(BaseModel):
    items: list[AuditPointOut]