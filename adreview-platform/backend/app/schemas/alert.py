"""Schemas for alert events surfaced on the Analytics → 异常分析 tab."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import Page


class AlertEventOut(BaseModel):
    id: int
    public_id: str = ""
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


# ---------------------------------------------------------------------------
# Root cause — per-alert detail drill-down.
#
# Three rule codes map to three different root-cause views; the response
# populates only the field matching the rule. Frontend decides which to render
# based on ``rule_code``.
# ---------------------------------------------------------------------------


class AlertRootCauseWindow(BaseModel):
    start: datetime
    end: datetime
    size_min: int


class AlertRootCauseAccount(BaseModel):
    account_id: str
    submitted: int
    rejected: int


class AlertRootCauseAccountIP(BaseModel):
    account_id: str
    ip: str
    submitted: int
    rejected: int


class AlertRootCauseResponse(BaseModel):
    alert_id: int
    rule_code: str
    rule_label: str
    window: AlertRootCauseWindow
    dimension: Dict[str, Any] = Field(default_factory=dict)
    # 互斥字段 — 按 rule_code 路由到的字段有值
    top_risk_labels: List[Dict[str, Any]] = Field(default_factory=list)
    top_accounts: List[AlertRootCauseAccount] = Field(default_factory=list)
    top_account_ips: List[AlertRootCauseAccountIP] = Field(default_factory=list)
