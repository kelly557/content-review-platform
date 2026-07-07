"""LibraryGroup schemas."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class LibraryGroupOut(ORMBase):
    id: int
    name: str
    description: Optional[str] = None
    sort_order: int
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class LibraryGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: Optional[str] = Field(default=None, max_length=200)
    sort_order: int = 100


class LibraryGroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = Field(default=None, max_length=200)
    sort_order: Optional[int] = None