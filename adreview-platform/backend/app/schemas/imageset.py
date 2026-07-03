"""ImageSet schemas."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.imageset import ImageSetAction, ImageSetGroup, ImageSetKind
from app.schemas.common import ORMBase


class ImageSetItemOut(ORMBase):
    id: int
    set_id: int
    original_filename: str
    mime_type: str
    file_size: int
    sha256: Optional[str] = None
    created_at: datetime
    download_url: Optional[str] = None


class ImageSetOut(ORMBase):
    id: int
    code: str
    name: str
    group: ImageSetGroup
    action: ImageSetAction
    kind: Optional[ImageSetKind] = None  # legacy
    description: Optional[str] = None
    is_active: bool
    item_count: int
    capacity: int
    ignored_services: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: Optional[datetime] = None


class ImageSetListItem(ORMBase):
    id: int
    code: str
    name: str
    group: ImageSetGroup
    action: ImageSetAction
    kind: Optional[ImageSetKind] = None  # legacy
    item_count: int
    capacity: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


class ImageSetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    group: ImageSetGroup = ImageSetGroup.KEYWORD
    action: ImageSetAction = ImageSetAction.BLOCK
    kind: Optional[ImageSetKind] = None  # 兼容旧客户端；后端忽略
    description: Optional[str] = Field(default=None, max_length=200)
    code: Optional[str] = None


class ImageSetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=20)
    group: Optional[ImageSetGroup] = None
    action: Optional[ImageSetAction] = None
    description: Optional[str] = Field(default=None, max_length=200)
    is_active: Optional[bool] = None


class ImageSetUploadResponse(BaseModel):
    uploaded: int
    skipped: int
    item_count: int
    capacity: int
    items: List[ImageSetItemOut]


class IgnoreToggleRequest(BaseModel):
    service_code: str
    enabled: bool


class IgnoreToggleResponse(BaseModel):
    ignored_services: List[str]
