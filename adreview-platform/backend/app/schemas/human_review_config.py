"""HumanReviewConfig schemas."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.human_review_config import RiskLevel
from app.schemas.common import ORMBase


class HumanReviewConfigOut(ORMBase):
    id: int
    service_code: str
    is_enabled: bool
    risk_levels: List[RiskLevel]
    review_rule_id: Optional[int]
    notify_plan_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]


class HumanReviewConfigUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    risk_levels: Optional[List[RiskLevel]] = None
    review_rule_id: Optional[int] = None
    notify_plan_id: Optional[int] = None

    @field_validator("risk_levels")
    @classmethod
    def _dedupe_levels(cls, v: Optional[List[RiskLevel]]) -> Optional[List[RiskLevel]]:
        if v is None:
            return v
        seen: list[RiskLevel] = []
        for r in v:
            if r not in seen:
                seen.append(r)
        return seen
