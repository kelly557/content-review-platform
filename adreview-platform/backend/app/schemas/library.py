"""Library / LibraryItem schemas."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.library import LibraryType
from app.schemas.common import ORMBase


# ────────── Library ──────────


class LibraryOut(ORMBase):
    id: int
    code: str
    name: str
    library_type: LibraryType
    group_id: int
    group_name: Optional[str] = None
    description: Optional[str] = None
    is_active: bool
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    item_count: int = 0
    ignored_services: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: Optional[datetime] = None


class LibraryListItem(ORMBase):
    id: int
    code: str
    name: str
    library_type: LibraryType
    group_id: int
    group_name: Optional[str] = None
    description: Optional[str] = None
    is_active: bool
    is_deleted: bool
    item_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None


def _dedupe_clean_words(v: List[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for w in v:
        w = (w or "").strip()
        if not w or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out


class LibraryCreate(BaseModel):
    code: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    library_type: LibraryType
    group_id: int
    description: Optional[str] = Field(default=None, max_length=200)
    words: List[str] = Field(default_factory=list)

    @field_validator("words")
    @classmethod
    def _v_words(cls, v: List[str]) -> List[str]:
        cleaned = _dedupe_clean_words(v)
        if len(cleaned) > 1000:
            raise ValueError("单次最多 1000 个词")
        return cleaned


class LibraryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    group_id: Optional[int] = None
    description: Optional[str] = Field(default=None, max_length=200)
    is_active: Optional[bool] = None
    ignored_services: Optional[List[str]] = None


class AuditPointRef(BaseModel):
    audit_point_id: int
    service_code: str
    label: str


class LibraryDeletePayload(BaseModel):
    transfer_to_library_id: Optional[int] = None
    force: bool = False


class LibraryDeleteResponse(BaseModel):
    ok: bool
    transferred_to: Optional[int] = None
    forced: bool = False
    affected_audit_points: int = 0
    references: List[AuditPointRef] = Field(default_factory=list)


class IgnoreToggleRequest(BaseModel):
    service_code: str
    enabled: bool


class IgnoreToggleResponse(BaseModel):
    ignored_services: List[str]


# ────────── LibraryItem ──────────


class LibraryItemOut(ORMBase):
    id: int
    library_id: int
    word: Optional[str] = None
    trigger: Optional[str] = None
    reply: Optional[str] = None
    original_filename: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    sha256: Optional[str] = None
    created_at: datetime
    download_url: Optional[str] = None


class LibraryItemCreate(BaseModel):
    words: List[str] = Field(default_factory=list)

    @field_validator("words")
    @classmethod
    def _v(cls, v: List[str]) -> List[str]:
        cleaned: List[str] = []
        for w in v:
            w = (w or "").strip()
            if w:
                cleaned.append(w)
        if len(cleaned) > 1000:
            raise ValueError("单次最多 1000 个词")
        return cleaned


class LibraryItemUpdate(BaseModel):
    word: str = Field(min_length=1, max_length=256)


class LibraryItemBatchDelete(BaseModel):
    item_ids: List[int]


class LibraryItemBatchDeleteResponse(BaseModel):
    deleted: int
    skipped: int


class LibraryItemImportRequest(BaseModel):
    source_library_id: int
    item_ids: List[int]


class LibraryImageUploadResponse(BaseModel):
    uploaded: int
    skipped: int
    item_count: int
    items: List[LibraryItemOut]


class LibraryItemUploadResponse(BaseModel):
    added: int
    skipped: int
    total: int


class LibraryBatchItem(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    library_type: LibraryType
    group_id: Optional[int] = None
    description: Optional[str] = Field(default=None, max_length=200)
    is_active: bool = True
    words: List[str] = Field(default_factory=list)

    @field_validator("words")
    @classmethod
    def _v_words(cls, v: List[str]) -> List[str]:
        cleaned = _dedupe_clean_words(v)
        if len(cleaned) > 1000:
            raise ValueError("单次最多 1000 个词")
        return cleaned


class LibraryBatchCreateRequest(BaseModel):
    group_id: Optional[int] = None
    libraries: List[LibraryBatchItem] = Field(min_length=1, max_length=20)


class LibraryBatchCreateError(BaseModel):
    index: int
    code: str
    error: str


class LibraryBatchCreateResult(BaseModel):
    succeeded: int
    failed: int
    libraries: List[LibraryOut] = Field(default_factory=list)
    errors: List[LibraryBatchCreateError] = Field(default_factory=list)
