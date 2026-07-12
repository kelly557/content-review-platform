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

    # Phase 1 of public_id rollout. Optional so schemas wrapping entities
    # without a `public_id` column (e.g. Tag, which is already UUID-keyed)
    # validate cleanly. Populated from the ORM's `public_id` attribute
    # when present.
    public_id: Optional[str] = None


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    size: int


class IDModel(ORMBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
