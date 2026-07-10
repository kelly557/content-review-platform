"""Schemas for alert events surfaced on the Analytics → 异常分析 tab."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import Page


class AlertEventOut(BaseModel):
    id: int
    rule_code: str
    severity: str
    metric: str
    window_start: datetime
    window_end: datetime
    observed_value: float
    threshold: float
    dimension: Dict[str, Any] = Field(default_factory=dict)
    detail: Dict[str, Any] = Field(default_factory=dict)
    status: str
    ack_by: Optional[int] = None
    ack_at: Optional[datetime] = None
    ack_note: Optional[str] = None
    notified: bool = False
    created_at: datetime


class AlertAckRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class AlertPage(Page[AlertEventOut]):
    pass
