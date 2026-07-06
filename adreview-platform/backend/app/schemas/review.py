"""Review + workflow + annotation schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.material import MaterialStatus, MaterialType
from app.models.review import ReviewDecision, ReviewType, MachineStatus
from app.schemas.common import ORMBase


class AnnotationCreate(BaseModel):
    page: Optional[int] = None
    frame: Optional[int] = None
    timestamp_ms: Optional[int] = None
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    shape: Optional[Dict[str, Any]] = None
    quote: Optional[str] = None
    body: str = Field(min_length=1)
    parent_id: Optional[int] = None


class AnnotationOut(ORMBase):
    id: int
    material_version_id: int
    author_id: int
    page: Optional[int]
    frame: Optional[int]
    timestamp_ms: Optional[int]
    x: Optional[float]
    y: Optional[float]
    w: Optional[float]
    h: Optional[float]
    shape: Optional[Dict[str, Any]]
    quote: Optional[str]
    body: str
    parent_id: Optional[int]
    resolved: bool
    created_at: datetime
    updated_at: Optional[datetime]


class ReviewDecisionRequest(BaseModel):
    decision: ReviewDecision
    note: Optional[str] = None
    comment_body: Optional[str] = None  # optional stage-level comment
    tag_ids: List[str] = Field(default_factory=list, max_length=20)


class ReviewAssignmentTagOut(ORMBase):
    id: int
    tag_id: str
    tag_snapshot: Dict[str, Any]
    created_at: datetime


class ReviewCommentOut(ORMBase):
    id: int
    task_id: int
    author_id: int
    body: str
    created_at: datetime


class ReviewAssignmentOut(ORMBase):
    id: int
    task_id: int
    assignee_id: int
    decision: ReviewDecision
    note: Optional[str]
    decided_at: Optional[datetime]
    tags: List[ReviewAssignmentTagOut] = Field(default_factory=list)


class AgentHit(BaseModel):
    service_code: str
    service_name: Optional[str] = None
    label: str
    label_cn: str
    score: float
    quote: Optional[str] = None
    bbox: Optional[Dict[str, float]] = None
    page: Optional[int] = None
    timestamp_ms: Optional[int] = None


class AgentRuleHit(BaseModel):
    rule_id: int
    label: str
    label_cn: str
    threshold: float
    matched: bool


class AgentStrategyRef(BaseModel):
    id: int
    code: str
    name: str


class AgentReviewResult(BaseModel):
    risk_level: str
    finished_at: datetime
    hits: List[AgentHit] = Field(default_factory=list)
    rule_hits: List[AgentRuleHit] = Field(default_factory=list)
    strategy: Optional[AgentStrategyRef] = None
    summary: Optional[str] = None


class ReviewTaskOut(ORMBase):
    id: int
    material_id: int
    material_version_id: int
    workflow_instance_id: int
    stage_key: str
    title: str
    review_type: ReviewType
    final_decision: ReviewDecision
    machine_status: Optional[MachineStatus] = None
    machine_result: Optional[Dict[str, Any]] = None
    machine_started_at: Optional[datetime] = None
    machine_completed_at: Optional[datetime] = None
    created_at: datetime
    completed_at: Optional[datetime]
    assignments: List[ReviewAssignmentOut] = Field(default_factory=list)
    comments: List[ReviewCommentOut] = Field(default_factory=list)
    material_type: Optional[MaterialType] = None
    material_status: Optional[MaterialStatus] = None

    @property
    def agent_review(self) -> Optional[AgentReviewResult]:
        if self.review_type == ReviewType.MACHINE and self.machine_result and self.machine_completed_at:
            return AgentReviewResult(
                risk_level=self.machine_result.get("risk_level", "无风险"),
                finished_at=self.machine_completed_at,
                hits=[AgentHit(**h) for h in self.machine_result.get("hits", [])],
                rule_hits=[AgentRuleHit(**r) for r in self.machine_result.get("rule_hits", [])],
                summary=self.machine_result.get("summary"),
            )
        return None


class BulkDecideRequest(BaseModel):
    task_ids: List[int]
    decision: ReviewDecision
    note: Optional[str] = None


class WorkflowNodeOut(ORMBase):
    id: int
    position: int
    stage_key: str
    name: str
    required_role: str
    mode: str
    node_type: str
    status: str


class WorkflowInstanceOut(ORMBase):
    id: int
    material_id: int
    material_version_id: int
    template_id: int
    state: str
    current_stage_key: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    nodes: List[WorkflowNodeOut] = Field(default_factory=list)


class WorkflowTemplateOut(ORMBase):
    id: int
    code: str
    name: str
    description: Optional[str]
    definition: Dict[str, Any]
    is_active: bool


class WorkflowStagePayload(BaseModel):
    """Stage shape accepted on create/update.

    ``key`` and ``type`` are filled by the backend; the client only
    supplies ``name``, ``role`` and ``mode``.
    """

    name: str = Field(min_length=1, max_length=64)
    role: str = Field(min_length=1, max_length=32)
    mode: str = Field(default="single", max_length=16)


class WorkflowTemplateCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_active: bool = True
    stages: List[WorkflowStagePayload] = Field(min_length=1)


class WorkflowTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = None
    stages: Optional[List[WorkflowStagePayload]] = Field(default=None, min_length=1)


class TransferRequest(BaseModel):
    """Forward a stage to another user (e.g. 加签/转交)."""

    to_user_id: int
    note: Optional[str] = None


class AddReviewerRequest(BaseModel):
    """Add an additional signer (会签/加签)."""

    user_id: int
    note: Optional[str] = None
