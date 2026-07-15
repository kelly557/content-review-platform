"""Schemas for the inspection result query page.

Aggregates ``review_tasks.machine_result`` (JSONB) + ``materials`` +
``review_assignments`` + ``review_assignment_tags`` into a flat, paginated
view keyed by task. No schema migration; the existing models already carry
everything we need.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase, Page


RISK_TO_DECISION: Dict[str, str] = {
    "高风险": "block",
    "中风险": "review",
    "低风险": "pass",
    "无风险": "pass",
}

DECISION_LABELS: Dict[str, str] = {
    "block": "阻断",
    "review": "复核",
    "pass": "通过",
}


ContentMedia = Literal["text", "image", "audio", "video"]
"""呈现内容维度: 文本 / 图片 / 音频 / 视频.

与 ``MaterialType`` (image/video/pdf/text) 的差异:
- ``pdf`` 折叠进 ``text`` (文本已被抽到 material_versions.text_body)
- ``audio`` 由 ``material_versions.mime_type`` 派生 (audio/*), 当前不在 MaterialType 枚举中
"""

CONTENT_MEDIA_LABELS: Dict[str, str] = {
    "text": "文本",
    "image": "图片",
    "audio": "音频",
    "video": "视频",
}


def derive_content_media(
    material_type: Optional[str],
    mime_type: Optional[str],
) -> Optional[ContentMedia]:
    """把 ``MaterialType`` + ``mime_type`` 归一到 4 值呈现内容.

    优先级: ``mime_type`` 前缀优先 (mime 更细), 在 mime 缺失时回退到 ``material_type``.
    """
    if mime_type:
        mt = mime_type.lower()
        if mt.startswith("audio/"):
            return "audio"
        if mt.startswith("video/"):
            return "video"
        if mt.startswith("image/"):
            return "image"
        if mt.startswith("text/"):
            return "text"
    if material_type is None:
        return None
    mt = str(material_type).lower()
    if mt in ("text", "pdf"):
        return "text"
    if mt == "image":
        return "image"
    if mt == "video":
        return "video"
    if mt == "audio":
        return "audio"
    return None


class AdvancedCondition(BaseModel):
    """A single ``contains`` / ``not_contains`` predicate for ``machine_result`` JSON."""

    op: str = Field(pattern="^(contains|not_contains)$")
    value: str = Field(min_length=1, max_length=128)


class MachineHitOut(BaseModel):
    """Single hit entry within ``machine_result.hits``."""

    service_code: Optional[str] = None
    service_name: Optional[str] = None
    label: Optional[str] = None
    label_cn: Optional[str] = None
    score: Optional[float] = None
    quote: Optional[str] = None


class MachineReviewRecordOut(ORMBase):
    """Flat projection of one ``ReviewTask`` row for the query page."""

    id: int
    title: Optional[str] = None
    review_type: Optional[str] = None
    final_decision: Optional[str] = None

    material_id: Optional[int] = None
    material_version_id: Optional[int] = None
    material_type: Optional[str] = None

    content_media: Optional[ContentMedia] = None
    preview_url: Optional[str] = None
    mime_type: Optional[str] = None
    text_body: Optional[str] = None

    strategy_code: Optional[str] = None
    strategy_name: Optional[str] = None

    risk_level: Optional[str] = None
    machine_decision: Optional[str] = None

    bailian_request_id: Optional[str] = None
    ip: Optional[str] = None
    account_id: Optional[str] = None

    submitter_id: Optional[int] = None
    submitter_name: Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None

    hits: List[MachineHitOut] = Field(default_factory=list)
    violation_tags: List[Dict[str, Any]] = Field(default_factory=list)
    summary: Optional[str] = None

    requested_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class QueryLabelsOut(BaseModel):
    """Distinct labels aggregated from ``machine_result.hits``."""

    labels: List[str]


class ReviewRecordOut(ORMBase):
    """Card-view projection of one ``ReviewTask`` for /query/review.

    Read-only; only shows machine and human review dimensions, no
    re-review (复审) fields.
    """

    id: int
    title: Optional[str] = None
    review_type: Optional[str] = None

    material_id: int
    material_version_id: int
    material_type: Optional[str] = None
    preview_url: Optional[str] = None
    mime_type: Optional[str] = None

    strategy_code: Optional[str] = None
    strategy_name: Optional[str] = None
    risk_level: Optional[str] = None
    machine_decision: Optional[str] = None
    machine_request_id: Optional[str] = None

    final_decision: Optional[str] = None

    submitter_id: Optional[int] = None
    submitter_name: Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None

    hits: List[MachineHitOut] = Field(default_factory=list)
    violation_tags: List[Dict[str, Any]] = Field(default_factory=list)
    summary: Optional[str] = None

    requested_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    ip: Optional[str] = None
    account_id: Optional[str] = None
    bailian_request_id: Optional[str] = None
    data_id: Optional[str] = None


QueryPage = Page[MachineReviewRecordOut]
ReviewPage = Page[ReviewRecordOut]