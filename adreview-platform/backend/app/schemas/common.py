"""Shared schema pieces."""
from datetime import datetime
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORMBase(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        use_enum_values=True,
        populate_by_name=True,
    )


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    size: int


class IDModel(ORMBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
