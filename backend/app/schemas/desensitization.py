"""Desensitization schemas."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class MaskSpanOut(BaseModel):
    start: int
    end: int
    category: str
    original: str


class MaskedHitOut(BaseModel):
    label: Optional[str] = None
    label_cn: Optional[str] = None
    category: Optional[str] = None
    original: str
    masked: str
    spans: List[MaskSpanOut] = Field(default_factory=list)


class MaskedBodyOut(BaseModel):
    original: str
    masked: str
    spans: List[MaskSpanOut] = Field(default_factory=list)


class DesensitizePlanOut(BaseModel):
    hits: List[MaskedHitOut] = Field(default_factory=list)
    body: Optional[MaskedBodyOut] = None


class DesensitizePreviewRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    whitelist: List[str] = Field(default_factory=list)


class DesensitizePreviewResponse(BaseModel):
    masked: str
    spans: List[MaskSpanOut] = Field(default_factory=list)
    category: Optional[str] = None


class DesensitizeApplyRequest(BaseModel):
    task_id: int
    whitelist: List[str] = Field(default_factory=list)
    """Apply the desensitize plan stored in ``machine_result.desensitize_plan``
    to the material version's ``text_body`` and the per-hit ``quote`` fields.

    Records an audit event so the original is recoverable by admins (and
    only admins) via the audit log.
    """


class DesensitizeApplyResponse(BaseModel):
    task_id: int
    masked_hits: List[MaskedHitOut] = Field(default_factory=list)
    masked_body: Optional[MaskedBodyOut] = None
    applied_at: str


class DesensitizationRuleOut(BaseModel):
    id: int
    category: str
    pattern: str
    mask_template: str
    description: Optional[str] = None
    enabled: bool
    service_code: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None