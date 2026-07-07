"""Knowledge extraction schemas — item / point draft + import request."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.audit_point import AuditPointRisk
from app.schemas.common import ORMBase


class KnowledgeExtractionPointOut(ORMBase):
    id: str
    extraction_id: str
    item_draft_id: str
    code: str
    label: str
    label_cn: str
    description: Optional[str] = None
    judgment_logic: Dict[str, Any] = Field(default_factory=dict)
    judgment_rule: Optional[str] = None
    judgment_basis: Optional[str] = None
    risk_level: AuditPointRisk = AuditPointRisk.MEDIUM
    medium_threshold: float = 60.0
    high_threshold: float = 90.0
    scope_text: Optional[str] = None
    selected: bool = True
    imported_point_id: Optional[int] = None
    created_at: datetime


class KnowledgeExtractionItemOut(ORMBase):
    id: str
    extraction_id: str
    code: str
    name_cn: str
    aliases: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    sort_order: int = 0
    selected: bool = True
    imported_item_id: Optional[int] = None
    points: List[KnowledgeExtractionPointOut] = Field(default_factory=list)
    created_at: datetime


class KnowledgeExtractionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    round_no: int
    model: Optional[str] = None
    prompt_tokens: int
    completion_tokens: int
    raw_response: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    chunk_count: int
    created_at: datetime
    items: List[KnowledgeExtractionItemOut] = Field(default_factory=list)


class KnowledgeExtractionItemPatch(BaseModel):
    name_cn: Optional[str] = Field(default=None, min_length=1, max_length=64)
    aliases: Optional[List[str]] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    selected: Optional[bool] = None


class KnowledgeExtractionPointPatch(BaseModel):
    label_cn: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = None
    judgment_logic: Optional[Dict[str, Any]] = None
    judgment_rule: Optional[str] = None
    judgment_basis: Optional[str] = None
    risk_level: Optional[AuditPointRisk] = None
    medium_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    high_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    selected: Optional[bool] = None

    @model_validator(mode="after")
    def _check_thresholds(self):
        if (
            self.medium_threshold is not None
            and self.high_threshold is not None
            and self.medium_threshold >= self.high_threshold
        ):
            raise ValueError("中风险分必须 < 高风险分")
        return self


class KnowledgeImportRequest(BaseModel):
    """User-confirmed subset to import into the standard rule tables."""

    item_ids: Optional[List[str]] = Field(
        default=None,
        description="要导入的 item id 列表；空表示导入所有 selected=True",
    )
    point_overrides: Optional[Dict[str, bool]] = Field(
        default=None,
        description="按 point_id 显式覆盖 selected（可把 selected=False 的 point 强行导入）",
    )
    target_service_code: Optional[str] = Field(
        default=None,
        description="自定义归属 Service.code；空则生成 knowledge_<domain>_<scope>",
    )
    enable_imported: bool = Field(default=True, description="导入后是否 is_enabled=true")


class KnowledgeImportResult(BaseModel):
    document_id: str
    extraction_id: str
    service_code: str
    imported_items: int
    imported_points: int
    item_id_map: Dict[str, int]
    point_id_map: Dict[str, int]