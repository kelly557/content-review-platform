"""MaterialPackage schemas."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.material_package import PackageStatus
from app.schemas.common import ORMBase
from app.schemas.material import MaterialOut


class MaterialPackageItemOut(ORMBase):
    id: int
    package_id: int
    material_id: int
    position: int
    review_task_id: Optional[int] = None
    material: Optional[MaterialOut] = None


class MaterialPackageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    material_type: str = Field(min_length=1, max_length=16)
    material_ids: List[int] = Field(default_factory=list)


class MaterialPackageUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    material_ids: Optional[List[int]] = None


class MaterialPackageOut(ORMBase):
    id: int
    name: str
    description: Optional[str]
    material_type: str
    status: PackageStatus
    creator_id: int
    created_at: datetime
    updated_at: datetime
    items: List[MaterialPackageItemOut] = Field(default_factory=list)


class MaterialPackageListItem(ORMBase):
    id: int
    name: str
    material_type: str
    status: PackageStatus
    creator_id: int
    created_at: datetime
    updated_at: datetime
    item_count: int = 0


class MaterialPackageSubmitRequest(BaseModel):
    workflow_template_code: Optional[str] = None
    force_human_rules: Optional[List[str]] = None
    task_name: Optional[str] = Field(default=None, max_length=255)
