"""Risk category schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class RiskCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    label: str
    color: str
    sort_order: int
    is_builtin: bool
    created_by_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class RiskCategoryCreate(BaseModel):
    """Step 1 表单只用 label；code 与 color 后端自动生成/分配。"""

    label: str = Field(..., min_length=1, max_length=30, description="用户可见名称")
