"""Library / LibraryItem schemas."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.library import LibraryKind, LibraryType
from app.schemas.common import ORMBase


# ────────── helpers ──────────


def is_effectively_active(
    is_active: bool,
    effective_from: Optional[datetime],
    effective_until: Optional[datetime],
    *,
    now: Optional[datetime] = None,
) -> bool:
    """派生字段：词库/图片库当前是否生效（用于 UI 展示与审核消费判断）。

    规则：
      - is_active=false → 不生效
      - effective_until 已过（< now）→ 不生效（过期）
      - effective_from 未到（> now）→ 不生效（未生效）
      - 其它 → 生效中或永久
    """
    if not is_active:
        return False
    moment = now or datetime.now(timezone.utc)
    # 规范化 naive datetime 为 UTC（防御性）
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    if effective_until is not None:
        eu = effective_until
        if eu.tzinfo is None:
            eu = eu.replace(tzinfo=timezone.utc)
        if moment >= eu:
            return False
    if effective_from is not None:
        ef = effective_from
        if ef.tzinfo is None:
            ef = ef.replace(tzinfo=timezone.utc)
        if moment < ef:
            return False
    return True


def _validate_effective_range(
    effective_from: Optional[datetime],
    effective_until: Optional[datetime],
) -> None:
    """校验：同时填时 from 必须严格小于 until。"""
    if effective_from is not None and effective_until is not None:
        if effective_from >= effective_until:
            raise ValueError("生效起始时间必须早于结束时间")


# ────────── Library ──────────


class LibraryOut(ORMBase):
    id: int
    code: str
    name: str
    library_type: LibraryType
    kind: Optional[LibraryKind] = None
    description: Optional[str] = None
    is_active: bool
    is_platform: bool = False
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    item_count: int = 0
    ignored_services: List[str] = Field(default_factory=list)
    # 有效时间区间（UTC）；两者皆空 = 永久
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    # 派生：当前是否生效。审核消费方应读此字段。
    is_effective: bool = True
    created_at: datetime
    updated_at: Optional[datetime] = None


class LibraryListItem(ORMBase):
    id: int
    code: str
    name: str
    library_type: LibraryType
    kind: Optional[LibraryKind] = None
    description: Optional[str] = None
    is_active: bool
    is_platform: bool = False
    is_deleted: bool
    item_count: int = 0
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    is_effective: bool = True
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
    # 词库/图片库必填 (黑名单 / 白名单)；代答库不传
    kind: Optional[LibraryKind] = None
    description: Optional[str] = Field(default=None, max_length=200)
    words: List[str] = Field(default_factory=list)
    # 有效时间区间；不传或为 null = 永久
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    # 「通用平台库」标记:仅超级管理员可设为 true;
    # 服务端在 create_library() 中会兜底守卫,非超管 POST 即使带 true 也会被抹为 false 并返回 422。
    is_platform: bool = False

    @field_validator("words")
    @classmethod
    def _v_words(cls, v: List[str]) -> List[str]:
        cleaned = _dedupe_clean_words(v)
        if len(cleaned) > 1000:
            raise ValueError("单次最多 1000 个词")
        return cleaned

    @model_validator(mode="after")
    def _v_kind(self) -> "LibraryCreate":
        if self.library_type in (LibraryType.WORD, LibraryType.IMAGE):
            if self.kind is None:
                raise ValueError("词库/图片库必须指定类型（黑名单 或 白名单）")
        else:
            # 代答库不暴露类型：若客户端误传 kind 则报错（避免静默吞数据）
            if self.kind is not None:
                raise ValueError("代答库不需要类型（kind 字段）")
            self.kind = None
            # 代答库强制不存有效时间（命中即触发，不该有"过期"概念）
            self.effective_from = None
            self.effective_until = None
        _validate_effective_range(self.effective_from, self.effective_until)
        return self


class LibraryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    kind: Optional[LibraryKind] = None
    description: Optional[str] = Field(default=None, max_length=200)
    is_active: Optional[bool] = None
    ignored_services: Optional[List[str]] = None
    # 允许显式置 null 来"清除有效期（永久）"
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    # 「通用平台库」标记:仅超级管理员可在 PATCH 里设置;
    # 缺省 / null = 不动该字段。仅超管请求且 key 显式在 body 里时才会落库。
    is_platform: Optional[bool] = None

    @model_validator(mode="after")
    def _v_kind(self) -> "LibraryUpdate":
        return self

    @model_validator(mode="after")
    def _v_effective(self) -> "LibraryUpdate":
        _validate_effective_range(self.effective_from, self.effective_until)
        return self


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
    kind: Optional[LibraryKind] = None
    description: Optional[str] = Field(default=None, max_length=200)
    is_active: bool = True
    words: List[str] = Field(default_factory=list)
    effective_from: Optional[datetime] = None
    effective_until: Optional[datetime] = None
    is_platform: bool = False

    @field_validator("words")
    @classmethod
    def _v_words(cls, v: List[str]) -> List[str]:
        cleaned = _dedupe_clean_words(v)
        if len(cleaned) > 1000:
            raise ValueError("单次最多 1000 个词")
        return cleaned

    @model_validator(mode="after")
    def _v_kind(self) -> "LibraryBatchItem":
        if self.library_type in (LibraryType.WORD, LibraryType.IMAGE):
            if self.kind is None:
                raise ValueError("词库/图片库必须指定类型（黑名单 或 白名单）")
        else:
            if self.kind is not None:
                raise ValueError("代答库不需要类型（kind 字段）")
            self.kind = None
            self.effective_from = None
            self.effective_until = None
        _validate_effective_range(self.effective_from, self.effective_until)
        return self


class LibraryBatchCreateRequest(BaseModel):
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
