"""AuditPoint schemas."""
from datetime import datetime
from typing import TYPE_CHECKING, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.audit_point import AuditPointRisk
from app.schemas.common import ORMBase

if TYPE_CHECKING:
    from app.models.audit_point import AuditPoint
    from app.models.library import Library


class LinkedLibraryOut(BaseModel):
    """Single library in a point's linked_libraries list."""

    library_id: int
    library_type: Literal["image", "word", "reply"]
    code: str
    name: str
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    sort_order: int = 0


def build_linked_libraries(point: "AuditPoint") -> list[LinkedLibraryOut]:
    """Serialize the audit_point_libraries join rows to LinkedLibraryOut list.

    Router calls this before model_validate(AuditPointOut) so the response
    can include linked_libraries even though they live in a separate table.

    `point.linked_libraries` is the M:N relationship to Library objects;
    `point.linked_library_links` is the AuditPointLibrary join rows
    (carries sort_order, created_at). We zip them by library_id to get
    both sides.

    NOTE: we deliberately do NOT touch `lib.group` here — that relationship
    isn't selectin-loaded and would trigger a lazy load which is not safe
    in async sessions. group_name is set to None; consumers can resolve
    it from a separate /library-groups call if needed.
    """
    libs_attr = getattr(point, "linked_libraries", None)
    if not isinstance(libs_attr, list):
        return []
    links_attr = getattr(point, "linked_library_links", None)
    if not isinstance(links_attr, list):
        return []
    out: list[LinkedLibraryOut] = []
    lib_by_id: dict[int, "Library"] = {}
    for lib in libs_attr:
        lib_by_id[lib.id] = lib
    for link in links_attr:
        lib = lib_by_id.get(link.library_id)
        if lib is None:
            continue
        out.append(
            LinkedLibraryOut(
                library_id=lib.id,
                library_type=lib.library_type.value
                if hasattr(lib.library_type, "value")
                else str(lib.library_type),
                code=lib.code,
                name=lib.name,
                group_id=lib.group_id,
                group_name=None,
                sort_order=link.sort_order,
            )
        )
    return out


def serialize_audit_point(point: "AuditPoint") -> dict:
    """Convert an AuditPoint ORM instance to a dict suitable for
    AuditPointOut.model_validate. Pydantic's from_attributes cannot easily
    handle the secondary-table relationship serialization, so we pre-build
    the linked_libraries list here."""
    data = {
        "id": point.id,
        "package_code": point.package_code,
        "item_id": point.item_id,
        "code": point.code,
        "label": point.label,
        "label_cn": point.label_cn,
        "description": point.description,
        "medium_threshold": point.medium_threshold,
        "high_threshold": point.high_threshold,
        "scope_text": point.scope_text,
        "risk_level": point.risk_level,
        "is_enabled": point.is_enabled,
        "custom_wordset_id": point.custom_wordset_id,
        "sort_order": point.sort_order,
        "linked_libraries": build_linked_libraries(point),
        "created_at": point.created_at,
        "updated_at": point.updated_at,
    }
    return data


class AuditPointOut(ORMBase):
    id: int
    package_code: str
    item_id: int
    code: str
    label: str
    label_cn: str
    description: Optional[str] = None
    medium_threshold: float
    high_threshold: float
    scope_text: Optional[str] = None
    risk_level: AuditPointRisk = AuditPointRisk.MEDIUM
    is_enabled: bool
    custom_wordset_id: Optional[int] = None
    sort_order: int = 0
    linked_libraries: list[LinkedLibraryOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: Optional[datetime] = None


class AuditPointCreate(BaseModel):
    item_id: int
    label_cn: str = Field(min_length=1, max_length=64)
    description: Optional[str] = None
    medium_threshold: float = Field(default=60.0, ge=0, le=100)
    high_threshold: float = Field(default=90.0, ge=0, le=100)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    risk_level: AuditPointRisk = AuditPointRisk.MEDIUM
    is_enabled: bool = False
    custom_wordset_id: Optional[int] = None
    sort_order: int = 0
    linked_library_ids: Optional[list[int]] = None

    @model_validator(mode="after")
    def _check_order(self):
        if self.medium_threshold >= self.high_threshold:
            raise ValueError("中风险分必须 < 高风险分")
        return self


class AuditPointUpdate(BaseModel):
    label_cn: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = None
    medium_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    high_threshold: Optional[float] = Field(default=None, ge=0, le=100)
    scope_text: Optional[str] = Field(default=None, max_length=255)
    risk_level: Optional[AuditPointRisk] = None
    is_enabled: Optional[bool] = None
    custom_wordset_id: Optional[int] = None
    sort_order: Optional[int] = None
    # PATCH semantics: None=不动；[]=清空；[非空]=全量替换。
    linked_library_ids: Optional[list[int]] = None

    @model_validator(mode="after")
    def _check_order(self):
        if (
            self.medium_threshold is not None
            and self.high_threshold is not None
            and self.medium_threshold >= self.high_threshold
        ):
            raise ValueError("中风险分必须 < 高风险分")
        return self


class AuditPointResetResult(BaseModel):
    items: list[AuditPointOut]


class AuditPointBatchCreate(BaseModel):
    item_id: int
    points: list[AuditPointCreate] = Field(min_length=1, max_length=100)


class AuditPointBatchItem(BaseModel):
    index: int
    label_cn: str
    status: Literal["ok", "error"]
    point: Optional[AuditPointOut] = None
    error: Optional[str] = None


class AuditPointBatchResult(BaseModel):
    succeeded: int
    failed: int
    items: list[AuditPointBatchItem]
