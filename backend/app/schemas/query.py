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

    优先级: ``material_type`` 优先 (用户上传时声明的类型更可靠),
    在缺失时回退到 ``mime_type`` 前缀.
    在线审核创建的占位 Material 的 mime_type 可能为 text/plain 但 material_type 为 image,
    此时按 material_type 归类.
    """
    if material_type:
        mt = str(material_type).lower()
        if mt == "image":
            return "image"
        if mt == "video":
            return "video"
        if mt == "audio":
            return "audio"
        if mt in ("text", "pdf"):
            return "text"
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
    return None


class MachineHitOut(BaseModel):
    """Single hit entry within ``machine_result.hits``."""

    service_code: Optional[str] = None
    service_name: Optional[str] = None
    audit_point_code: Optional[str] = None
    label: Optional[str] = None
    label_cn: Optional[str] = None
    score: Optional[float] = None
    quote: Optional[str] = None
    risk_category_code: Optional[str] = None
    risk_category_label: Optional[str] = None
    audit_item_code: Optional[str] = None
    audit_item_label: Optional[str] = None
    audit_point_label: Optional[str] = None


class RiskTaxonomyNode(BaseModel):
    """Tree node used by ``GET /query/risk-taxonomy``.

    Two-level tree: audit_item (一级, 审核项) → audit_point (二级, 审核点).
    Each level exposes ``code`` (wire identifier) and ``label`` (display).
    The leaf level also carries ``path`` which is the slash-joined path of
    codes; this is the value sent back in ``risk_label_paths`` query filter.
    """

    code: str
    label: str
    path: str
    children: List["RiskTaxonomyNode"] = Field(default_factory=list)


RiskTaxonomyNode.model_rebuild()


class RiskTaxonomyOut(BaseModel):
    items: List[RiskTaxonomyNode]


class MachineReviewRecordOut(ORMBase):
    """Flat projection of one ``ReviewTask`` row for the query page."""

    id: int
    public_id: Optional[str] = None
    title: Optional[str] = None
    review_type: Optional[str] = None
    final_decision: Optional[str] = None

    material_id: Optional[int] = None
    material_version_id: Optional[int] = None
    material_version_public_id: Optional[str] = None
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
    channel: Optional[str] = None

    submitter_id: Optional[int] = None
    submitter_name: Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None

    hits: List[MachineHitOut] = Field(default_factory=list)
    violation_tags: List[Dict[str, Any]] = Field(default_factory=list)
    summary: Optional[str] = None

    last_feedback: Optional["MachineReviewFeedbackOut"] = None

    requested_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    machine_result: Optional[Dict[str, Any]] = None


class QueryLabelsOut(BaseModel):
    """Distinct labels aggregated from ``machine_result.hits``."""

    labels: List[str]


# 操作列反馈的 kind 与数据查询页"反馈结果"筛选保持一致。
MachineReviewFeedbackKind = Literal["false_positive", "false_negative"]


class ReviewRecordOut(ORMBase):
    """Card-view projection of one ``ReviewTask`` for /query/review.

    Read-only; only shows machine and human review dimensions, no
    re-review (复审) fields.
    """

    id: int
    public_id: Optional[str] = None
    title: Optional[str] = None
    review_type: Optional[str] = None

    material_id: int
    material_version_id: int
    material_version_public_id: Optional[str] = None
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

    last_feedback: Optional["MachineReviewFeedbackOut"] = None

    machine_result: Optional[Dict[str, Any]] = None


class MachineReviewFeedbackIn(BaseModel):
    kind: Literal["false_positive", "false_negative"] = Field(description="false_positive=未违规误报，false_negative=违规漏报")
    note: Optional[str] = Field(default=None, max_length=500)


class MachineReviewFeedbackOut(ORMBase):
    id: int
    public_id: Optional[str] = None
    task_id: int
    kind: str
    note: Optional[str] = None
    created_by_id: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime


QueryPage = Page[MachineReviewRecordOut]
ReviewPage = Page[ReviewRecordOut]
