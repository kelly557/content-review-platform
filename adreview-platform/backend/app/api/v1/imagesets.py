"""Legacy imagesets API — compatibility shim over /libraries.

Behaves like the old endpoints but routes to the unified Library model.
Image items live in library_items (storage_key/sha256/...).
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.audit_point import AuditPoint
from app.models.library import Library, LibraryType
from app.models.library_group import LibraryGroup
from app.models.library_item import LibraryItem
from app.models.user import User
from app.schemas.common import Page
from app.schemas.imageset import (
    ImageSetCreate,
    ImageSetItemOut,
    ImageSetListItem,
    ImageSetOut,
    ImageSetUpdate,
    ImageSetUploadResponse,
)
from app.services import storage

router = APIRouter(prefix="/imagesets", tags=["imagesets"])

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILES_PER_UPLOAD = 100
MAX_FILE_BYTES = 10 * 1024 * 1024
_DEFAULT_GROUP_NAME = "默认分组"


async def _ensure_default_group(db: AsyncSession) -> LibraryGroup:
    g = (
        await db.execute(
            select(LibraryGroup).where(LibraryGroup.name == _DEFAULT_GROUP_NAME)
        )
    ).scalar_one_or_none()
    if g is None:
        g = LibraryGroup(name=_DEFAULT_GROUP_NAME, sort_order=0)
        db.add(g)
        await db.flush()
        await db.refresh(g)
    return g


def _to_out(
    lib: Library, item_count: int, ignored: List[str]
) -> ImageSetOut:
    return ImageSetOut.model_validate(
        {
            "id": lib.id,
            "code": lib.code,
            "name": lib.name,
            "group": "关键词",
            "action": "黑名单",
            "kind": "黑名单",
            "description": lib.description,
            "is_active": lib.is_active,
            "item_count": item_count,
            "capacity": 5000,
            "ignored_services": ignored,
            "created_at": lib.created_at,
            "updated_at": lib.updated_at,
        }
    )


def _to_list(
    lib: Library, item_count: int
) -> ImageSetListItem:
    return ImageSetListItem.model_validate(
        {
            "id": lib.id,
            "code": lib.code,
            "name": lib.name,
            "group": "关键词",
            "action": "黑名单",
            "kind": "黑名单",
            "item_count": item_count,
            "capacity": 5000,
            "is_active": lib.is_active,
            "created_at": lib.created_at,
            "updated_at": lib.updated_at,
        }
    )


def _item_to_out(it: LibraryItem) -> ImageSetItemOut:
    out = ImageSetItemOut.model_validate(
        {
            "id": it.id,
            "set_id": it.library_id,
            "original_filename": it.original_filename,
            "mime_type": it.mime_type,
            "file_size": it.file_size or 0,
            "sha256": it.sha256,
            "created_at": it.created_at,
        }
    )
    out.download_url = f"/api/v1/imagesets/{it.library_id}/items/{it.id}/download"
    return out


async def _count(db: AsyncSession, lib_id: int) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(LibraryItem)
            .where(
                and_(
                    LibraryItem.library_id == lib_id,
                    LibraryItem.is_deleted == False,  # noqa: E712
                )
            )
        )
        or 0
    )


@router.get("", response_model=Page[ImageSetListItem])
async def list_imagesets(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    group: Optional[str] = None,
    action: Optional[str] = None,
    kind: Optional[str] = None,
    q: Optional[str] = None,
):
    stmt = select(Library).where(
        and_(Library.library_type == LibraryType.IMAGE, Library.is_deleted == False)  # noqa: E712
    )
    if q:
        stmt = stmt.where(or_(Library.name.ilike(f"%{q}%"), Library.code.ilike(f"%{q}%")))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(Library.id.desc()).offset((page - 1) * size).limit(size)
    libs = list((await db.execute(stmt)).scalars())
    items = [_to_list(l, await _count(db, l.id)) for l in libs]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/{imageset_id}", response_model=ImageSetOut)
async def get_imageset(
    imageset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, imageset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=404, detail="数据集不存在")
    return _to_out(lib, await _count(db, lib.id), list(lib.ignored_services or []))


@router.get("/{imageset_id}/items", response_model=Page[ImageSetItemOut])
async def list_items(
    imageset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(60, ge=1, le=200),
):
    lib = await db.get(Library, imageset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=404, detail="数据集不存在")
    base = select(LibraryItem).where(
        and_(LibraryItem.library_id == lib.id, LibraryItem.is_deleted == False)  # noqa: E712
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    base = base.order_by(LibraryItem.id.desc()).offset((page - 1) * size).limit(size)
    items = [_item_to_out(i) for i in (await db.execute(base)).scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=ImageSetOut, status_code=201)
async def create_imageset(
    body: ImageSetCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    grp = await _ensure_default_group(db)
    code = body.code
    if not code:
        result = await db.execute(select(Library.code).where(Library.code.like("is_%")))
        used = {row[0] for row in result.all()}
        n = 1
        while f"is_{n}" in used:
            n += 1
        code = f"is_{n}"

    lib = Library(
        code=code,
        name=body.name.strip(),
        library_type=LibraryType.IMAGE,
        group_id=grp.id,
        description=body.description,
        is_active=True,
        ignored_services=[],
    )
    db.add(lib)
    await db.flush()
    await db.refresh(lib)
    await db.commit()
    return _to_out(lib, 0, [])


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
    "/{imageset_id}/items",
    response_model=ImageSetUploadResponse,
    status_code=201,
)
async def upload_items(
    imageset_id: int,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, imageset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=404, detail="数据集不存在")
    if not files:
        raise HTTPException(status_code=400, detail="未提供文件")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(status_code=400, detail=f"单次最多上传 {MAX_FILES_PER_UPLOAD} 张图片")

    existing_sha = {
        row[0]
        for row in (
            await db.execute(
                select(LibraryItem.sha256).where(
                    and_(
                        LibraryItem.library_id == lib.id,
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
            key, size, sha = storage.save_image_upload(lib.id, f.filename or "upload.bin", _BytesIO(content))
            if sha in existing_sha:
                skipped += 1
                continue
            item = LibraryItem(
                library_id=lib.id,
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
        await db.commit()
        return ImageSetUploadResponse(
            uploaded=len(uploaded),
            skipped=skipped,
            item_count=await _count(db, lib.id),
            capacity=5000,
            items=[_item_to_out(i) for i in uploaded],
        )
    except storage.StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{imageset_id}", response_model=ImageSetOut)
async def update_imageset(
    imageset_id: int,
    body: ImageSetUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, imageset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=404, detail="数据集不存在")
    if body.name is not None:
        lib.name = body.name.strip()
    if body.description is not None:
        lib.description = body.description
    if body.is_active is not None:
        lib.is_active = body.is_active
    await db.flush()
    await db.refresh(lib)
    await db.commit()
    return _to_out(lib, await _count(db, lib.id), list(lib.ignored_services or []))


@router.delete("/{imageset_id}", status_code=204)
async def delete_imageset(
    imageset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = (
        await db.execute(
            select(Library)
            .where(Library.id == imageset_id)
            .options(selectinload(Library.items))
        )
    ).scalar_one_or_none()
    if not lib or lib.is_deleted or lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=404, detail="数据集不存在")
    aps = await db.execute(
        select(AuditPoint).where(AuditPoint.custom_library_id == lib.id)
    )
    for ap in aps.scalars():
        ap.custom_library_id = None
    for it in lib.items:
        try:
            if it.storage_key:
                storage.delete_object(it.storage_key)
        except Exception:
            pass
        it.is_deleted = True
        it.deleted_at = datetime.utcnow()
    lib.is_deleted = True
    lib.deleted_at = datetime.utcnow()
    await db.flush()
    await db.commit()


@router.delete(
    "/{imageset_id}/items/{item_id}", status_code=204
)
async def delete_item(
    imageset_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, imageset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=404, detail="数据集不存在")
    it = await db.get(LibraryItem, item_id)
    if not it or it.library_id != lib.id:
        raise HTTPException(status_code=404, detail="图片不存在")
    try:
        if it.storage_key:
            storage.delete_object(it.storage_key)
    except Exception:
        pass
    it.is_deleted = True
    it.deleted_at = datetime.utcnow()
    await db.flush()
    await db.commit()


class _IgnoreRequest(BaseModel):
    service_code: str
    enabled: bool


class _IgnoreResponse(BaseModel):
    ignored_services: List[str]


@router.post("/{imageset_id}/ignore", response_model=_IgnoreResponse)
async def toggle_ignore(
    imageset_id: int,
    body: _IgnoreRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, imageset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.IMAGE:
        raise HTTPException(status_code=404, detail="数据集不存在")
    services = list(lib.ignored_services or [])
    if body.enabled and body.service_code not in services:
        services.append(body.service_code)
    if not body.enabled and body.service_code in services:
        services.remove(body.service_code)
    lib.ignored_services = services
    await db.flush()
    await db.refresh(lib)
    await db.commit()
    return _IgnoreResponse(ignored_services=services)