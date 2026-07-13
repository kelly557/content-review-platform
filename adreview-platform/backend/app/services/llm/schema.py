"""Pydantic schema for the LLM moderation output."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class ModerationHit(BaseModel):
    """A single hit on the material's text."""

    service_code: str
    service_name: Optional[str] = None
    label: str
    label_cn: str
    score: float = Field(ge=0.0, le=1.0)
    quote: Optional[str] = None
    sensitive_grade: str = Field(default="S0")

    @field_validator("sensitive_grade")
    @classmethod
    def _validate_grade(cls, v: str) -> str:
        allowed = {"S0", "S1", "S2", "S3"}
        if v not in allowed:
            return "S0"
        return v


class ModerationRuleHit(BaseModel):
    rule_id: int
    label: str
    label_cn: str
    threshold: float = Field(ge=0.0, le=1.0, default=0.5)
    matched: bool
    sensitive_grade: str = Field(default="S0")

    @field_validator("sensitive_grade")
    @classmethod
    def _validate_grade(cls, v: str) -> str:
        return v if v in {"S0", "S1", "S2", "S3"} else "S0"


class ModerationResult(BaseModel):
    risk_level: str
    sensitive_level: str = Field(default="S0")
    hits: List[ModerationHit] = Field(default_factory=list)
    rule_hits: List[ModerationRuleHit] = Field(default_factory=list)
    summary: Optional[str] = None
