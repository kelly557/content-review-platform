"""Library CRUD + items.

Unified endpoint for both word and image libraries. The single type field
selects behavior:

- GET /libraries?type=word|image
- POST /libraries  body.library_type + group_id
- POST /libraries/{id}/items  (word: JSON; image: multipart)
- DELETE /libraries/{id}  body.transfer_to_library_id / body.force

Soft-delete always; the legacy word_sets / image_sets tables remain
write-through via app/api/v1/wordsets.py and app/api/v1/imagesets.py.
"""
from __future__ import annotations

import re as _re
from datetime import datetime
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, require_roles

from app.db.session import get_db
from app.models.audit_point import AuditPoint
from app.models.library import Library, LibraryType
from app.models.library_group import LibraryGroup
from app.models.library_item import LibraryItem
from app.models.library_item_reference import LibraryItemReference
from app.models.user import User
from app.schemas.common import Page
from app.schemas.library import (
    AuditPointRef,
    IgnoreToggleRequest,
    IgnoreToggleResponse,
    LibraryBatchCreateError,
    LibraryBatchCreateRequest,
    LibraryBatchCreateResult,
    LibraryBatchItem,
    LibraryCreate,
    LibraryDeletePayload,
    LibraryDeleteResponse,
LibraryImageUploadResponse,
    LibraryItemUploadResponse,
    LibraryItemBatchDelete,
    LibraryItemBatchDeleteResponse,
    LibraryItemCreate,
    LibraryItemImportRequest,
    LibraryItemOut,
    LibraryItemUpdate,
    LibraryListItem,
    LibraryOut,
    LibraryUpdate,
)
from app.services import storage

router = APIRouter(prefix="/libraries", tags=["libraries"])


ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILES_PER_UPLOAD = 100
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_WORDS = 1000
WORD_CODE_RE = _re.compile(r"^ws_\d+$")
IMAGE_CODE_RE = _re.compile(r"^is_\d+$")
GENERIC_CODE_RE = _re.compile(r"^lib_[a-z]?\d+$")


# ─── helpers ────────────────────────────────────────────────────────────


def _is_valid_code(code: str, library_type: LibraryType) -> bool:
    if not code or len(code) > 64:
        return False
    if library_type == LibraryType.WORD:
        return (
            bool(WORD_CODE_RE.match(code))
            or bool(GENERIC_CODE_RE.match(code))
            or code.startswith("lib_w_")
            or code.startswith("lib_word_")
        )
    if library_type == LibraryType.IMAGE:
        return (
            bool(IMAGE_CODE_RE.match(code))
            or bool(GENERIC_CODE_RE.match(code))
            or code.startswith("lib_i_")
            or code.startswith("lib_img_")
        )
    if library_type == LibraryType.REPLY:
        return (
            bool(GENERIC_CODE_RE.match(code))
            or code.startswith("lib_r_")
            or code.startswith("lib_reply_")
        )
    return bool(GENERIC_CODE_RE.match(code))


async def _next_code(db: AsyncSession, prefix: str) -> str:
    result = await db.execute(
        select(Library.code).where(Library.code.like(f"{prefix}%"))
    )
    used = {row[0] for row in result.all()}
    n = 1
    while f"{prefix}{n}" in used:
        n += 1
    return f"{prefix}{n}"


def _enrich_group_name(lib: Library, group_name_map: dict[int, str]) -> None:
    lib.group_name = group_name_map.get(lib.group_id)


async def _group_name_map(db: AsyncSession, group_ids: List[int]) -> dict[int, str]:
    if not group_ids:
        return {}
    rows = await db.execute(
        select(LibraryGroup.id, LibraryGroup.name).where(
            LibraryGroup.id.in_(group_ids)
        )
    )
    return {i: n for i, n in rows.all()}


def _to_out(lib: Library, item_count: int, group_name: Optional[str]) -> LibraryOut:
    return LibraryOut.model_validate(
        {
            "id": lib.id,
            "code": lib.code,
            "name": lib.name,
            "library_type": lib.library_type,
            "group_id": lib.group_id,
            "group_name": group_name,
            "description": lib.description,
            "is_active": lib.is_active,
            "is_deleted": lib.is_deleted,
            "deleted_at": lib.deleted_at,
            "item_count": item_count,
            "ignored_services": list(lib.ignored_services or []),
            "created_at": lib.created_at,
            "updated_at": lib.updated_at,
        }
    )


def _to_list(
    lib: Library, item_count: int, group_name: Optional[str]
) -> LibraryListItem:
    return LibraryListItem.model_validate(
        {
            "id": lib.id,
            "code": lib.code,
            "name": lib.name,
            "library_type": lib.library_type,
            "group_id": lib.group_id,
            "group_name": group_name,
            "description": lib.description,
            "is_active": lib.is_active,
            "is_deleted": lib.is_deleted,
            "item_count": item_count,
            "created_at": lib.created_at,
            "updated_at": lib.updated_at,
        }
    )


async def _counts_for_libraries(
    db: AsyncSession, lib_ids: List[int]
) -> dict[int, int]:
    if not lib_ids:
        return {}
    rows = await db.execute(
        select(LibraryItem.library_id, func.count(LibraryItem.id))
        .where(
            and_(
                LibraryItem.library_id.in_(lib_ids),
                LibraryItem.is_deleted == False,  # noqa: E712
            )
        )
        .group_by(LibraryItem.library_id)
    )
    return {lid: n for lid, n in rows.all()}


# ─── CRUD ───────────────────────────────────────────────────────────────


@router.get("", response_model=Page[LibraryListItem])
async def list_libraries(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    type: Optional[LibraryType] = Query(None),
    group_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    include_deleted: bool = Query(False),
) -> Page[LibraryListItem]:
    stmt = select(Library)
    conds = []
    if not include_deleted:
        conds.append(Library.is_deleted == False)  # noqa: E712
    if type is not None:
        conds.append(Library.library_type == type)
    if group_id is not None:
        conds.append(Library.group_id == group_id)
    if is_active is not None:
        conds.append(Library.is_active == is_active)
    if q:
        conds.append(
            or_(Library.name.ilike(f"%{q}%"), Library.code.ilike(f"%{q}%"))
        )
    if conds:
        stmt = stmt.where(and_(*conds))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(Library.id.desc()).offset((page - 1) * size).limit(size)
    libs = list((await db.execute(stmt)).scalars())
    counts = await _counts_for_libraries(db, [l.id for l in libs])
    group_names = await _group_name_map(db, [l.group_id for l in libs])
    items = [_to_list(l, counts.get(l.id, 0), group_names.get(l.group_id)) for l in libs]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/{library_id}", response_model=LibraryOut)
async def get_library(
    library_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryOut:
    lib = await db.get(Library, library_id)
    if not lib:
        raise HTTPException(status_code=404, detail="库不存在")
    counts = await _counts_for_libraries(db, [lib.id])
    group_names = await _group_name_map(db, [lib.group_id])
    return _to_out(lib, counts.get(lib.id, 0), group_names.get(lib.group_id))


@router.get("/{library_id}/references", response_model=List[AuditPointRef])
async def list_library_references(
    library_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[AuditPointRef]:
    rows = await db.execute(
        select(AuditPoint.id, AuditPoint.package_code, AuditPoint.label).where(
            AuditPoint.custom_library_id == library_id
        )
    )
    return [
        AuditPointRef(audit_point_id=i, service_code=p, label=l) for i, p, l in rows.all()
    ]


@router.post("", response_model=LibraryOut, status_code=status.HTTP_201_CREATED)
async def create_library(
    body: LibraryCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryOut:
    grp = await db.get(LibraryGroup, body.group_id)
    if not grp or grp.is_deleted:
        raise HTTPException(status_code=400, detail="分组不存在或已删除")

    if body.code:
        ok = (
            (body.library_type == LibraryType.WORD and WORD_CODE_RE.match(body.code))
            or (
                body.library_type == LibraryType.IMAGE
                and IMAGE_CODE_RE.match(body.code)
            )
            or (body.library_type == LibraryType.REPLY and body.code.startswith("lib_r_"))
            or GENERIC_CODE_RE.match(body.code)
        )
        if not ok:
            raise HTTPException(status_code=400, detail="code 格式不合法")
        existing = await db.execute(select(Library).where(Library.code == body.code))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="code 已存在")
        code = body.code
    else:
        if body.library_type == LibraryType.WORD:
            prefix = "lib_w_"
        elif body.library_type == LibraryType.IMAGE:
            prefix = "lib_i_"
        else:
            prefix = "lib_r_"
        code = await _next_code(db, prefix)

    lib = Library(
        code=code,
        name=body.name.strip(),
        library_type=body.library_type,
        group_id=body.group_id,
        description=body.description,
        is_active=True,
        ignored_services=[],
    )
    db.add(lib)
    await db.flush()

    if body.library_type == LibraryType.WORD and body.words:
        seen: set[str] = set()
        for w in body.words:
            w = (w or "").strip()
            if not w or w in seen:
                continue
            seen.add(w)
            db.add(LibraryItem(library_id=lib.id, word=w))
        await db.flush()
    elif body.library_type == LibraryType.REPLY and body.words:
        seen_pair: set[tuple[str, str]] = set()
        for raw in body.words:
            raw = (raw or "").strip()
            if not raw:
                continue
            t = r = ""
            sep_idx = -1
            sep_ch = ""
            for ch in ("|||", "\\t", "\t"):
                idx = raw.find(ch)
                if idx > 0:
                    sep_idx = idx
                    sep_ch = ch
                    break
            if sep_idx > 0:
                t = raw[:sep_idx].strip()
                r = raw[sep_idx + len(sep_ch):].strip()
            elif "," in raw:
                t, r = raw.split(",", 1)
                t, r = t.strip(), r.strip()
            if not t or not r:
                continue
            key = (t, r)
            if key in seen_pair:
                continue
            seen_pair.add(key)
            db.add(
                LibraryItem(library_id=lib.id, trigger=t, reply=r)
            )
        await db.flush()

    await db.refresh(lib)
    counts = await _counts_for_libraries(db, [lib.id])
    group_names = await _group_name_map(db, [lib.group_id])
    await db.commit()
    return _to_out(lib, counts.get(lib.id, 0), group_names.get(lib.group_id))


@router.post(
    "/batch-create",
    response_model=LibraryBatchCreateResult,
    status_code=status.HTTP_201_CREATED,
)
async def batch_create_libraries(
    body: LibraryBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> LibraryBatchCreateResult:
    """Create up to 20 libraries in one call.

    Each library is its own transaction — failures do not abort the batch.
    """
    created: List[LibraryOut] = []
    errors: List[LibraryBatchCreateError] = []

    default_group_id = body.group_id
    if default_group_id is not None:
        grp = await db.get(LibraryGroup, default_group_id)
        if not grp or grp.is_deleted:
            default_group_id = None

    for idx, item in enumerate(body.libraries):
        try:
            gid = item.group_id if item.group_id is not None else default_group_id
            if gid is None:
                raise ValueError("group_id 必填")
            grp = await db.get(LibraryGroup, gid)
            if not grp or grp.is_deleted:
                raise ValueError("分组不存在或已删除")

            code = item.code.strip()
            if not code:
                raise ValueError("code 不能为空")
            existing = await db.execute(
                select(Library).where(Library.code == code)
            )
            if existing.scalar_one_or_none():
                raise ValueError("code 已存在")

            if not _is_valid_code(code, item.library_type):
                raise ValueError("code 格式不合法")

            lib = Library(
                code=code,
                name=item.name.strip(),
                library_type=item.library_type,
                group_id=gid,
                description=item.description,
                is_active=item.is_active,
                ignored_services=[],
            )
            db.add(lib)
            await db.flush()

            if item.library_type in (LibraryType.WORD, LibraryType.REPLY) and item.words:
                seen: set[str] = set()
                for w in item.words:
                    w = (w or "").strip()
                    if not w or w in seen:
                        continue
                    seen.add(w)
                    if item.library_type == LibraryType.WORD:
                        db.add(LibraryItem(library_id=lib.id, word=w))
                    else:
                        trigger_reply = w
                        sep = "|||"
                        pos = trigger_reply.find(sep)
                        if pos > 0:
                            db.add(
                                LibraryItem(
                                    library_id=lib.id,
                                    trigger=trigger_reply[:pos].strip(),
                                    reply=trigger_reply[pos + 3 :].strip(),
                                )
                            )
                await db.flush()

            await db.refresh(lib)
            counts = await _counts_for_libraries(db, [lib.id])
            group_names = await _group_name_map(db, [lib.group_id])
            await db.commit()
            created.append(
                _to_out(
                    lib,
                    counts.get(lib.id, 0),
                    group_names.get(lib.group_id),
                )
            )
        except Exception as e:  # noqa: BLE001
            await db.rollback()
            errors.append(
                LibraryBatchCreateError(
                    index=idx,
                    code=getattr(item, "code", "") or "",
                    error=str(e),
                )
            )

    return LibraryBatchCreateResult(
        succeeded=len(created),
        failed=len(errors),
        libraries=created,
        errors=errors,
    )


@router.put("/{library_id}", response_model=LibraryOut)
async def update_library(
    library_id: int,
    body: LibraryUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryOut:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    if body.name is not None:
        lib.name = body.name.strip()
    if body.group_id is not None:
        grp = await db.get(LibraryGroup, body.group_id)
        if not grp or grp.is_deleted:
            raise HTTPException(status_code=400, detail="目标分组不存在或已删除")
        lib.group_id = body.group_id
    if body.description is not None:
        lib.description = body.description
    if body.is_active is not None:
        lib.is_active = body.is_active
    if body.ignored_services is not None:
        lib.ignored_services = list(body.ignored_services)
    await db.flush()
    await db.refresh(lib)
    counts = await _counts_for_libraries(db, [lib.id])
    group_names = await _group_name_map(db, [lib.group_id])
    await db.commit()
    return _to_out(lib, counts.get(lib.id, 0), group_names.get(lib.group_id))


@router.delete("/{library_id}", response_model=LibraryDeleteResponse)
async def delete_library(
    library_id: int,
    body: LibraryDeletePayload,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryDeleteResponse:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")

    refs_rows = await db.execute(
        select(AuditPoint.id, AuditPoint.package_code, AuditPoint.label).where(
            AuditPoint.custom_library_id == library_id
        )
    )
    refs = [
        AuditPointRef(audit_point_id=i, service_code=p, label=l)
        for i, p, l in refs_rows.all()
    ]
    has_refs = bool(refs)

    transferred_to: Optional[int] = None
    forced = False

    if body.transfer_to_library_id is not None:
        target = await db.get(Library, body.transfer_to_library_id)
        if not target or target.is_deleted:
            raise HTTPException(status_code=400, detail="目标库不存在或已删除")
        if target.library_type != lib.library_type:
            raise HTTPException(status_code=400, detail="目标库类型不匹配")
        for ap in (
            await db.execute(
                select(AuditPoint).where(AuditPoint.custom_library_id == library_id)
            )
        ).scalars():
            ap.custom_library_id = target.id
        transferred_to = target.id
    elif body.force:
        for ap in (
            await db.execute(
                select(AuditPoint).where(AuditPoint.custom_library_id == library_id)
            )
        ).scalars():
            ap.custom_library_id = None
        forced = True
    elif has_refs:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "该库被审核点引用,请选择转移或强制删除",
                "references": [r.model_dump() for r in refs],
                "total": len(refs),
            },
        )

    lib.is_deleted = True
    lib.deleted_at = datetime.utcnow()

    items = (
        await db.execute(
            select(LibraryItem).where(
                and_(
                    LibraryItem.library_id == lib.id,
                    LibraryItem.is_deleted == False,  # noqa: E712
                )
            )
        )
    ).scalars()
    for it in list(items):
        it.is_deleted = True
        it.deleted_at = datetime.utcnow()

    await db.flush()
    await db.commit()

    return LibraryDeleteResponse(
        ok=True,
        transferred_to=transferred_to,
        forced=forced,
        affected_audit_points=len(refs),
        references=refs,
    )


@router.post("/{library_id}/ignore", response_model=IgnoreToggleResponse)
async def toggle_ignore(
    library_id: int,
    body: IgnoreToggleRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> IgnoreToggleResponse:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    services = list(lib.ignored_services or [])
    if body.enabled and body.service_code not in services:
        services.append(body.service_code)
    if not body.enabled and body.service_code in services:
        services.remove(body.service_code)
    lib.ignored_services = services
    await db.flush()
    await db.refresh(lib)
    await db.commit()
    return IgnoreToggleResponse(ignored_services=services)


# ─── items ──────────────────────────────────────────────────────────────


def _item_to_out(item: LibraryItem) -> LibraryItemOut:
    out = LibraryItemOut.model_validate(
        {
            "id": item.id,
            "library_id": item.library_id,
            "word": item.word,
            "trigger": item.trigger,
            "reply": item.reply,
            "original_filename": item.original_filename,
            "mime_type": item.mime_type,
            "file_size": item.file_size,
            "sha256": item.sha256,
            "created_at": item.created_at,
        }
    )
    if item.storage_key:
        out.download_url = (
            f"/api/v1/libraries/{item.library_id}/items/{item.id}/download"
        )
    return out


@router.get("/{library_id}/items", response_model=Page[LibraryItemOut])
async def list_items(
    library_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(60, ge=1, le=200),
    keyword: Optional[str] = Query(None),
    include_deleted: bool = Query(False),
) -> Page[LibraryItemOut]:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    stmt = select(LibraryItem).where(LibraryItem.library_id == library_id)
    if not include_deleted:
        stmt = stmt.where(LibraryItem.is_deleted == False)  # noqa: E712
    if keyword:
        stmt = stmt.where(LibraryItem.word.ilike(f"%{keyword}%"))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(LibraryItem.id.desc()).offset((page - 1) * size).limit(size)
    items = [_item_to_out(i) for i in (await db.execute(stmt)).scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post(
    "/{library_id}/items", response_model=Page[LibraryItemOut], status_code=201
)
async def add_items(
    library_id: int,
    body: LibraryItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Page[LibraryItemOut]:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    if lib.library_type not in (LibraryType.WORD, LibraryType.REPLY):
        raise HTTPException(
            status_code=400, detail="该接口仅用于词库/代答库"
        )

    if len(body.words) > MAX_WORDS:
        raise HTTPException(
            status_code=400, detail=f"单次最多 {MAX_WORDS} 个词/对"
        )

    if lib.library_type == LibraryType.WORD:
        existing = {
            row[0]
            for row in (
                await db.execute(
                    select(LibraryItem.word).where(
                        and_(
                            LibraryItem.library_id == library_id,
                            LibraryItem.is_deleted == False,  # noqa: E712
                        )
                    )
                )
            ).all()
            if row[0]
        }
        added = 0
        skipped = 0
        inserted: list[LibraryItem] = []
        seen: set[str] = set()
        for w in body.words:
            w = (w or "").strip()
            if not w or w in seen or w in existing:
                skipped += 1
                continue
            seen.add(w)
            it = LibraryItem(library_id=library_id, word=w)
            db.add(it)
            inserted.append(it)
            added += 1
        if added:
            await db.flush()
            for it in inserted:
                await db.refresh(it)
            await db.commit()
    else:
        # REPLY: each entry is 'trigger ||| reply' (or trigger<tab>reply / trigger,reply)
        existing = {
            (row[0], row[1])
            for row in (
                await db.execute(
                    select(LibraryItem.trigger, LibraryItem.reply).where(
                        and_(
                            LibraryItem.library_id == library_id,
                            LibraryItem.is_deleted == False,  # noqa: E712
                        )
                    )
                )
            ).all()
            if row[0] and row[1]
        }
        added = 0
        skipped = 0
        inserted = []
        seen: set[tuple[str, str]] = set()
        for raw in body.words:
            raw = (raw or "").strip()
            if not raw:
                skipped += 1
                continue
            t = r = ""
            sep_idx = -1
            sep_ch = ""
            for ch in ("|||", "\\t", "\t"):
                idx = raw.find(ch)
                if idx > 0:
                    sep_idx = idx
                    sep_ch = ch
                    break
            if sep_idx > 0:
                t = raw[:sep_idx].strip()
                r = raw[sep_idx + len(sep_ch):].strip()
            elif "," in raw:
                t, r = raw.split(",", 1)
                t, r = t.strip(), r.strip()
            else:
                skipped += 1
                continue
            if not t or not r:
                skipped += 1
                continue
            key = (t, r)
            if key in seen or key in existing:
                skipped += 1
                continue
            seen.add(key)
            it = LibraryItem(library_id=library_id, trigger=t, reply=r)
            db.add(it)
            inserted.append(it)
            added += 1
        if added:
            await db.flush()
            for it in inserted:
                await db.refresh(it)
            await db.commit()

    base = select(LibraryItem).where(
        and_(LibraryItem.library_id == library_id, LibraryItem.is_deleted == False)  # noqa: E712
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = [_item_to_out(i) for i in (await db.execute(base.order_by(LibraryItem.id.desc()))).scalars()]
    return Page(items=items, total=total, page=1, size=len(items))


@router.put("/{library_id}/items/{item_id}", response_model=LibraryItemOut)
async def update_item(
    library_id: int,
    item_id: int,
    body: LibraryItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryItemOut:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    if lib.library_type != LibraryType.WORD:
        raise HTTPException(status_code=400, detail="该接口仅用于词库")
    it = await db.get(LibraryItem, item_id)
    if not it or it.library_id != library_id:
        raise HTTPException(status_code=404, detail="词条不存在")
    new_word = body.word.strip()
    if not new_word:
        raise HTTPException(status_code=400, detail="词条不能为空")
    dup = await db.execute(
        select(LibraryItem).where(
            and_(
                LibraryItem.library_id == library_id,
                LibraryItem.word == new_word,
                LibraryItem.id != item_id,
                LibraryItem.is_deleted == False,  # noqa: E712
            )
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="该词已存在")
    it.word = new_word
    await db.flush()
    await db.refresh(it)
    await db.commit()
    return _item_to_out(it)


@router.delete(
    "/{library_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_item(
    library_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    it = await db.get(LibraryItem, item_id)
    if not it or it.library_id != library_id:
        raise HTTPException(status_code=404, detail="词条/图片不存在")
    it.is_deleted = True
    it.deleted_at = datetime.utcnow()
    await db.flush()
    await db.commit()


@router.post(
    "/{library_id}/items/batch-delete",
    response_model=LibraryItemBatchDeleteResponse,
)
async def batch_delete_items(
    library_id: int,
    body: LibraryItemBatchDelete,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryItemBatchDeleteResponse:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    if not body.item_ids:
        return LibraryItemBatchDeleteResponse(deleted=0, skipped=0)
    items = (
        await db.execute(
            select(LibraryItem).where(
                and_(
                    LibraryItem.library_id == library_id,
                    LibraryItem.id.in_(body.item_ids),
                    LibraryItem.is_deleted == False,  # noqa: E712
                )
            )
        )
    ).scalars()
    deleted = 0
    now = datetime.utcnow()
    found_ids = set()
    for it in list(items):
        it.is_deleted = True
        it.deleted_at = now
        deleted += 1
        found_ids.add(it.id)
    skipped = len(body.item_ids) - len(found_ids)
    await db.flush()
    await db.commit()
    return LibraryItemBatchDeleteResponse(deleted=deleted, skipped=skipped)


@router.post("/{library_id}/items/import", response_model=LibraryItemBatchDeleteResponse)
async def import_items(
    library_id: int,
    body: LibraryItemImportRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryItemBatchDeleteResponse:
    target = await db.get(Library, library_id)
    if not target or target.is_deleted:
        raise HTTPException(status_code=404, detail="目标库不存在")
    src = await db.get(Library, body.source_library_id)
    if not src or src.is_deleted:
        raise HTTPException(status_code=404, detail="源库不存在")
    if target.library_type != src.library_type:
        raise HTTPException(status_code=400, detail="源库与目标库类型不一致")
    if target.id == src.id:
        raise HTTPException(status_code=400, detail="源库与目标库相同")

    src_items = (
        await db.execute(
            select(LibraryItem).where(
                and_(
                    LibraryItem.library_id == body.source_library_id,
                    LibraryItem.id.in_(body.item_ids or []),
                    LibraryItem.is_deleted == False,  # noqa: E712
                )
            )
        )
    ).scalars()

    added = 0
    for it in list(src_items):
        exists = await db.execute(
            select(LibraryItemReference).where(
                and_(
                    LibraryItemReference.item_id == it.id,
                    LibraryItemReference.library_id == library_id,
                )
            )
        )
        if exists.scalar_one_or_none():
            continue
        db.add(LibraryItemReference(item_id=it.id, library_id=library_id))
        added += 1
    await db.flush()
    await db.commit()
    return LibraryItemBatchDeleteResponse(deleted=0, skipped=0)


# ─── image upload (multipart) ───────────────────────────────────────────


class _BytesIO:
    def __init__(self, data: bytes) -> None:
        self._buf = data
        self._pos = 0

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            chunk = self._buf[self._pos:]
            self._pos = len(self._buf)
            return chunk
        chunk = self._buf[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk


@router.post(
    "/{library_id}/upload",
    response_model=LibraryImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_images(
    library_id: int,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryImageUploadResponse:
    lib = (
        await db.execute(
            select(Library)
            .where(Library.id == library_id)
            .options(selectinload(Library.items))
        )
    ).scalar_one_or_none()
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    if lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=400, detail="该接口仅用于图库")

    if not files:
        raise HTTPException(status_code=400, detail="未提供文件")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多上传 {MAX_FILES_PER_UPLOAD} 张图片",
        )

    existing_sha = {
        row[0]
        for row in (
            await db.execute(
                select(LibraryItem.sha256).where(
                    and_(
                        LibraryItem.library_id == library_id,
                        LibraryItem.is_deleted == False,  # noqa: E712
                    )
                )
            )
        ).all()
        if row[0]
    }

    uploaded: list[LibraryItem] = []
    skipped = 0
    try:
        for f in files:
            mime = f.content_type or ""
            if mime not in ALLOWED_MIME:
                skipped += 1
                continue
            content = await f.read()
            if not content or len(content) > MAX_FILE_BYTES:
                skipped += 1
                continue
            key, size, sha = storage.save_image_upload(
                library_id, f.filename or "upload.bin", _BytesIO(content)
            )
            if sha in existing_sha:
                skipped += 1
                continue
            item = LibraryItem(
                library_id=library_id,
                storage_key=key,
                original_filename=f.filename or "upload.bin",
                mime_type=mime,
                file_size=size,
                sha256=sha,
            )
            db.add(item)
            uploaded.append(item)
            existing_sha.add(sha)
        if uploaded:
            await db.flush()
            for it in uploaded:
                await db.refresh(it)
        total_after = (
            await db.scalar(
                select(func.count())
                .select_from(LibraryItem)
                .where(
                    and_(
                        LibraryItem.library_id == library_id,
                        LibraryItem.is_deleted == False,  # noqa: E712
                    )
                )
            )
            or 0
        )
        await db.commit()
        return LibraryImageUploadResponse(
            uploaded=len(uploaded),
            skipped=skipped,
            item_count=total_after,
            items=[_item_to_out(i) for i in uploaded],
        )
    except storage.StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── words upload (multipart .txt) ───────────────────────────────────────


@router.post(
    "/{library_id}/items/upload",
    response_model=LibraryItemUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_words(
    library_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> LibraryItemUploadResponse:
    lib = await db.get(Library, library_id)
    if not lib or lib.is_deleted:
        raise HTTPException(status_code=404, detail="库不存在")
    if lib.library_type not in (LibraryType.WORD, LibraryType.REPLY):
        raise HTTPException(
            status_code=400, detail="该接口仅用于词库/代答库"
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("gbk")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="文件编码不支持,请使用 UTF-8 或 GBK 编码的 txt")

    added = 0
    skipped = 0
    inserted: list[LibraryItem] = []

    if lib.library_type == LibraryType.WORD:
        words: list[str] = []
        for line in text.splitlines():
            w = line.strip()
            if w:
                words.append(w)
        if len(words) > MAX_WORDS:
            raise HTTPException(
                status_code=400, detail=f"单次最多 {MAX_WORDS} 个词"
            )
        existing = {
            row[0]
            for row in (
                await db.execute(
                    select(LibraryItem.word).where(
                        and_(
                            LibraryItem.library_id == library_id,
                            LibraryItem.is_deleted == False,  # noqa: E712
                        )
                    )
                )
            ).all()
        }
        seen: set[str] = set()
        for w in words:
            if w in seen or w in existing:
                skipped += 1
                continue
            seen.add(w)
            it = LibraryItem(library_id=library_id, word=w)
            db.add(it)
            inserted.append(it)
            added += 1
    else:
        # REPLY: each row "trigger<TAB or |||>reply"
        pairs: list[tuple[str, str]] = []
        for line in text.splitlines():
            s = line.strip()
            if not s:
                continue
            t = r = ""
            if "|||" in s:
                t, r = s.split("|||", 1)
            elif "\t" in s:
                t, r = s.split("\t", 1)
            elif "," in s:
                # csv-style trigger,reply — only first comma
                t, r = s.split(",", 1)
            t, r = t.strip(), r.strip()
            if not t or not r:
                continue
            pairs.append((t, r))
        if len(pairs) > MAX_WORDS:
            raise HTTPException(
                status_code=400, detail=f"单次最多 {MAX_WORDS} 对"
            )
        existing = {
            (row[0], row[1])
            for row in (
                await db.execute(
                    select(LibraryItem.trigger, LibraryItem.reply).where(
                        and_(
                            LibraryItem.library_id == library_id,
                            LibraryItem.is_deleted == False,  # noqa: E712
                        )
                    )
                )
            ).all()
            if row[0] and row[1]
        }
        seen_pair: set[tuple[str, str]] = set()
        for pair in pairs:
            if pair in seen_pair or pair in existing:
                skipped += 1
                continue
            seen_pair.add(pair)
            it = LibraryItem(
                library_id=library_id, trigger=pair[0], reply=pair[1]
            )
            db.add(it)
            inserted.append(it)
            added += 1

    if added:
        await db.flush()
        await db.commit()

    total = (
        await db.scalar(
            select(func.count())
            .select_from(LibraryItem)
            .where(
                and_(
                    LibraryItem.library_id == library_id,
                    LibraryItem.is_deleted == False,  # noqa: E712
                )
            )
        )
        or 0
    )
    return LibraryItemUploadResponse(added=added, skipped=skipped, total=total)


@router.get("/{library_id}/items/{item_id}/download")
async def download_image(
    library_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from fastapi.responses import StreamingResponse

    it = await db.get(LibraryItem, item_id)
    if not it or it.library_id != library_id or it.is_deleted or not it.storage_key:
        raise HTTPException(status_code=404, detail="图片不存在")

    def _stream():
        return storage.open_stream(it.storage_key)

    return StreamingResponse(
        _stream(),
        media_type=it.mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{it.original_filename or "download"}"'
        },
    )