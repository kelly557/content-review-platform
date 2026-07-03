"""DetectionRule schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMBase


class DetectionRuleOut(ORMBase):
    id: int
    service_code: str
    label: str
    label_cn: str
    description: Optional[str]
    medium_threshold: float
    high_threshold: float
    scope_text: Optional[str]
    is_enabled: bool
    custom_wordset_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]


class DetectionRuleUpdate(BaseModel):
    medium_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    high_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    is_enabled: Optional[bool] = None
    custom_wordset_id: Optional[int] = None

    @model_validator(mode="after")
    def _check_order(self):
        if (
            self.medium_threshold is not None
            and self.high_threshold is not None
            and self.medium_threshold >= self.high_threshold
        ):
            raise ValueError("中风险分必须 < 高风险分")
        return self


class DetectionRuleResetResult(BaseModel):
    items: list[DetectionRuleOut]
