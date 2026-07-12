"""Material schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.material import MaterialStatus, MaterialType
from app.schemas.common import ORMBase
from app.schemas.strategy import HumanReviewSettings


class MaterialVersionOut(ORMBase):
    id: int
    material_id: int
    version_no: int
    original_filename: str
    mime_type: str
    file_size: int
    text_body: Optional[str] = None
    created_at: datetime
    download_url: Optional[str] = None


class MaterialCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    material_type: MaterialType
    tags: Dict[str, Any] = Field(default_factory=dict)
    extra_metadata: Dict[str, Any] = Field(default_factory=dict)


class MaterialUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    tags: Optional[Dict[str, Any]] = None
    extra_metadata: Optional[Dict[str, Any]] = None


class MaterialOut(ORMBase):
    id: int
    title: str
    description: Optional[str]
    material_type: MaterialType
    status: MaterialStatus
    submitter_id: int
    current_version_id: Optional[int]
    tags: Dict[str, Any] = Field(default_factory=dict)
    # NOTE: the underlying SQLAlchemy column is named "metadata" (DB-side) but
    # the Python attribute is `extra_metadata`. We can't use `alias="metadata"`
    # here because SQLAlchemy's Base class also exposes a `metadata` class
    # attribute (sqlalchemy.MetaData instance) which would shadow the JSONB
    # field during Pydantic attribute lookup. Read/write via the Python
    # attribute name; serialization uses the field name "extra_metadata".
    extra_metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    versions: List[MaterialVersionOut] = Field(default_factory=list)


class MaterialListItem(ORMBase):
    id: int
    title: str
    material_type: MaterialType
    status: MaterialStatus
    submitter_id: int
    current_version_id: Optional[int]
    updated_at: datetime


class MaterialSubmitRequest(BaseModel):
    """Submit a new version for review, optionally starting a workflow instance."""

    note: Optional[str] = None
    task_name: Optional[str] = Field(default=None, max_length=255)
    skip_machine_review: bool = Field(default=False, description="Skip automatic machine review, require manual trigger")
    override_human_review: Optional[HumanReviewSettings] = Field(
        default=None,
        description="任务级 step-3 处置覆盖。字段级合并：非空字段覆盖策略默认值，空字段走 strategy。",
    )


class MaterialBatchUploadItem(ORMBase):
    index: int
    ok: bool
    filename: Optional[str] = None
    material: Optional[MaterialOut] = None
    error: Optional[str] = None


class MaterialBatchUploadResponse(BaseModel):
    total: int
    succeeded: int
    failed: int
    items: List[MaterialBatchUploadItem]
