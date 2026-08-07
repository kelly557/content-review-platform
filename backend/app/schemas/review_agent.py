"""Review Agent schemas."""
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class AgentPoint(BaseModel):
    id: Optional[str] = None
    label: str
    desc: Optional[str] = None


class ReviewAgentCreate(BaseModel):
    app_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    modality: str = Field(max_length=16)
    model_id: Optional[int] = None
    points: List[AgentPoint] = Field(default_factory=list)


class ReviewAgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=128)
    modality: Optional[str] = Field(default=None, max_length=16)
    model_id: Optional[int] = None
    points: Optional[List[AgentPoint]] = None


class ReviewAgentOut(ORMBase):
    id: int
    app_id: str
    name: str
    modality: str
    status: str
    model_id: Optional[int] = None
    points: Optional[List[Any]] = None
    online_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    draft_saved_at: Optional[datetime] = None
    current_version: Optional[str] = None
    created_at: datetime


class AgentVersionSnapshot(BaseModel):
    modality: str
    name: str
    modelId: Optional[str] = None
    points: List[AgentPoint] = Field(default_factory=list)


class ReviewAgentVersionOut(ORMBase):
    id: int
    agent_id: int
    version: str
    status: str
    is_current: bool
    snapshot: Optional[Any] = None
    published_at: datetime


class AgentTestRequest(BaseModel):
    modality: str = "文本"
    text: str = ""
    mode: str = "single"  # single | multi
    points: List[AgentPoint] = Field(default_factory=list)


class AgentTestTriggeredPoint(BaseModel):
    pointId: str
    label: str
    triggered: bool


class AgentTestResult(BaseModel):
    decision: str  # pass | block
    latencyMs: int
    confidence: float
    triggered: List[AgentTestTriggeredPoint]
    rawOutput: str


class AiOptimizeRequest(BaseModel):
    direction: str = Field(min_length=1, max_length=500)
    original_label: Optional[str] = None
    docs_context: Optional[str] = None


class AiOptimizeResult(BaseModel):
    original: str
    issues: List[dict] = Field(default_factory=list)
    checklist: List[str] = Field(default_factory=list)
    scenarioNote: str = ""
    cases: dict = Field(default_factory=dict)
    direction: str
    finalTag: dict = Field(default_factory=dict)
