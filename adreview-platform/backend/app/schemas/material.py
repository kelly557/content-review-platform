"""Material schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.material import MaterialStatus, MaterialType
from app.schemas.common import ORMBase


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
