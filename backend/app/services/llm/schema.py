"""Pydantic schema for the LLM moderation output."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class ModerationHit(BaseModel):
    """A single hit on the material's text."""

    service_code: str
    service_name: Optional[str] = None
    # LLM 必须输出注入 prompt 的审核点 code 之一, 用于后端精确匹配标签树.
    # 校验在 parser 层做 (需拿到 audit_points 上下文); schema 层仅声明.
    # 默认空字符串: 兼容旧测试数据 / 无 audit_points 注入的场景.
    audit_point_code: str = ""
    label: str
    label_cn: str
    score: float = Field(ge=0.0, le=1.0)
    # 违规片段定位: LLM 只输出 start/length (不复述原文, 避免网关输出审查拦截).
    # 后端用 original_text[start:start+length] 重建 quote.
    start: Optional[int] = None
    length: Optional[int] = None
    quote: Optional[str] = None
    sensitive_grade: str = Field(default="S0")
    # LLM 自评的单 hit 风险等级 (高风险|中风险|低风险|敏感|无风险).
    # aggregate_risk_level_v2 会优先采用此值 (若在合法 5 档内), 避免
    # 仅靠 label_cn 关键字 substring 猜的脆弱判定.
    risk: Optional[str] = None

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
