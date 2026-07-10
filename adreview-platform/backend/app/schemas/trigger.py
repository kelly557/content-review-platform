"""Pydantic schemas for triggers and trigger runs."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMBase


TriggerTypeStr = Literal["cron", "external_callback"]


# ── Trigger ────────────────────────────────────────────────────
class TriggerBase(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    trigger_type: TriggerTypeStr
    is_enabled: bool = True

    spec: Dict[str, Any] = Field(default_factory=dict)
    workflow_template_code: Optional[str] = Field(default=None, max_length=64)
    strategy_id: Optional[int] = None
    match_conditions: Dict[str, Any] = Field(default_factory=dict)
    scan_interval_sec: int = Field(default=60, ge=10, le=3600)

    @field_validator("match_conditions")
    @classmethod
    def _validate_match_conditions(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        # Each value must be a list of strings (or absent).
        for k, val in v.items():
            if k not in {
                "material_type",
                "business_line",
                "country",
                "channel",
                "content_category",
            }:
                # Allow arbitrary keys too (forward-compat), but flag value type.
                pass
            if val is None:
                continue
            if not isinstance(val, list):
                raise ValueError(f"match_conditions[{k}] must be a list")
            for item in val:
                if not isinstance(item, str):
                    raise ValueError(f"match_conditions[{k}] items must be strings")
        return v


class TriggerCreate(TriggerBase):
    pass


class TriggerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    is_enabled: Optional[bool] = None
    spec: Optional[Dict[str, Any]] = None
    workflow_template_code: Optional[str] = Field(default=None, max_length=64)
    strategy_id: Optional[int] = None
    match_conditions: Optional[Dict[str, Any]] = None
    scan_interval_sec: Optional[int] = Field(default=None, ge=10, le=3600)


class TriggerOut(ORMBase):
    id: int
    code: str
    name: str
    trigger_type: TriggerTypeStr
    is_enabled: bool

    spec: Dict[str, Any]
    workflow_template_code: Optional[str]
    strategy_id: Optional[int]
    strategy_name: Optional[str] = None
    match_conditions: Dict[str, Any]
    scan_interval_sec: int
    last_run_at: Optional[datetime]
    next_run_at: Optional[datetime]
    run_count: int
    last_error: Optional[str]

    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime


# ── TriggerRun ────────────────────────────────────────────────
class TriggerRunOut(ORMBase):
    id: int
    trigger_id: int
    source: str
    started_at: datetime
    finished_at: Optional[datetime]
    status: Optional[str]

    scanned_count: int
    created_count: int
    skipped_count: int
    failed_count: int
    error: Optional[str]
    details: Optional[Dict[str, Any]]


class TriggerRunListOut(BaseModel):
    items: List[TriggerRunOut]
    total: int