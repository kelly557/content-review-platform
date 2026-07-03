"""ImageSet router: list / create / upload / delete / ignore-toggle.

All routes require an authenticated user (any role). Upload is constrained to
the configured image MIME whitelist and per-request + per-set item caps.
"""
from __future__ import annotations

import re as _re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.imageset import ImageSet, ImageSetAction, ImageSetGroup, ImageSetItem, ImageSetKind
from app.models.user import User
from app.schemas.common import Page
from app.schemas.imageset import (
    IgnoreToggleRequest,
    IgnoreToggleResponse,
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
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per file (additional cap beyond global)

_CODE_RE = _re.compile(r"^is_\d+$")


async def _next_code(db: AsyncSession) -> str:
    result = await db.execute(select(ImageSet.code))
    used = {row[0] for row in result.all()}
    n = 1
    while f"is_{n}" in used:
        n += 1
    return f"is_{n}"


def _to_out(s: ImageSet) -> ImageSetOut:
    return ImageSetOut.model_validate(
        {
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "group": s.group,
            "action": s.action,
            "kind": s.kind,
            "description": s.description,
            "is_active": s.is_active,
            "item_count": s.item_count,
            "capacity": s.capacity,
            "ignored_services": list(s.ignored_services or []),
            "created_at": s.created_at,
            "updated_at": s.updated_at,
        }
    )


def _to_list(s: ImageSet) -> ImageSetListItem:
    return ImageSetListItem.model_validate(
        {
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "group": s.group,
            "action": s.action,
            "kind": s.kind,
            "item_count": s.item_count,
            "capacity": s.capacity,
            "is_active": s.is_active,
            "created_at": s.created_at,
            "updated_at": s.updated_at,
        }
    )


def _item_to_out(item: ImageSetItem) -> ImageSetItemOut:
    out = ImageSetItemOut.model_validate(
        {
            "id": item.id,
            "set_id": item.set_id,
            "original_filename": item.original_filename,
            "mime_type": item.mime_type,
            "file_size": item.file_size,
            "sha256": item.sha256,
            "created_at": item.created_at,
        }
    )
    out.download_url = f"/api/v1/imagesets/{item.set_id}/items/{item.id}/download"
    return out


@router.get("", response_model=Page[ImageSetListItem])
async def list_imagesets(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    group: ImageSetGroup | None = None,
    action: ImageSetAction | None = None,
    kind: ImageSetKind | None = None,  # legacy
    q: str | None = None,
) -> Page[ImageSetListItem]:
    stmt = select(ImageSet)
    conds = []
    if group:
        conds.append(ImageSet.group == group)
    if action:
        conds.append(ImageSet.action == action)
    if kind and not group and not action:
        conds.append(
            ImageSet.action == ("黑名单" if kind == ImageSetKind.BLACKLIST else "白名单")
        )
    if q:
        conds.append(or_(ImageSet.name.ilike(f"%{q}%"), ImageSet.code.ilike(f"%{q}%")))
    if conds:
        stmt = stmt.where(and_(*conds))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(ImageSet.id.desc()).offset((page - 1) * size).limit(size)
    items = [_to_list(s) for s in (await db.execute(stmt)).scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/{imageset_id}", response_model=ImageSetOut)
async def get_imageset(
    imageset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ImageSetOut:
    s = await db.get(ImageSet, imageset_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    return _to_out(s)


@router.get("/{imageset_id}/items", response_model=Page[ImageSetItemOut])
async def list_items(
    imageset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(60, ge=1, le=200),
) -> Page[ImageSetItemOut]:
    s = await db.get(ImageSet, imageset_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    base = select(ImageSetItem).where(ImageSetItem.set_id == imageset_id)
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    base = base.order_by(ImageSetItem.id.desc()).offset((page - 1) * size).limit(size)
    items = [_item_to_out(i) for i in (await db.execute(base)).scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=ImageSetOut, status_code=status.HTTP_201_CREATED)
async def create_imageset(
    body: ImageSetCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ImageSetOut:
    if body.code:
        if not _CODE_RE.match(body.code):
            raise HTTPException(status_code=400, detail="code 必须以 is_ 开头后接数字")
        existing = await db.execute(select(ImageSet).where(ImageSet.code == body.code))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="code 已存在")
        code = body.code
    else:
        code = await _next_code(db)
    legacy_kind = (
        ImageSetKind.BLACKLIST
        if body.action in (ImageSetAction.BLOCK, ImageSetAction.REVIEW, ImageSetAction.TAG)
        else ImageSetKind.WHITELIST
    )
    s = ImageSet(
        code=code,
        name=body.name.strip(),
        group=body.group,
        action=body.action,
        kind=legacy_kind,
        description=body.description,
        is_active=True,
        ignored_services=[],
        item_count=0,
        capacity=5000,
    )
    db.add(s)
    await db.flush()
    await db.refresh(s)
    await db.commit()
    return _to_out(s)


@router.post(
    "/{imageset_id}/items",
    response_model=ImageSetUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_items(
    imageset_id: int,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ImageSetUploadResponse:
    s = await db.get(ImageSet, imageset_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")

    if not files:
        raise HTTPException(status_code=400, detail="未提供文件")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多上传 {MAX_FILES_PER_UPLOAD} 张图片",
        )
    remaining = s.capacity - s.item_count
    if remaining <= 0:
        raise HTTPException(status_code=409, detail="数据集已满，无法继续上传")
    if len(files) > remaining:
        raise HTTPException(
            status_code=409,
            detail=f"超出容量限制：剩余 {remaining} 张，本次上传 {len(files)} 张",
        )

    uploaded_items: list[ImageSetItem] = []
    skipped = 0
    try:
        for f in files:
            mime = f.content_type or ""
            if mime not in ALLOWED_MIME:
                skipped += 1
                continue
            content = await f.read()
            if not content:
                skipped += 1
                continue
            if len(content) > MAX_FILE_BYTES:
                skipped += 1
                continue
            key, size, sha = storage.save_image_upload(
                s.id, f.filename or "upload.bin", _BytesIO(content)
            )
            item = ImageSetItem(
                set_id=s.id,
                storage_key=key,
                original_filename=f.filename or "upload.bin",
                mime_type=mime,
                file_size=size,
                sha256=sha,
            )
            db.add(item)
            uploaded_items.append(item)
        if uploaded_items:
            await db.flush()
            s.item_count = (s.item_count or 0) + len(uploaded_items)
            await db.flush()
            await db.refresh(s)
        items_out = [_item_to_out(i) for i in uploaded_items]
        if uploaded_items:
            await db.commit()
        return ImageSetUploadResponse(
            uploaded=len(uploaded_items),
            skipped=skipped,
            item_count=s.item_count,
            capacity=s.capacity,
            items=items_out,
        )
    except storage.StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{imageset_id}", response_model=ImageSetOut)
async def update_imageset(
    imageset_id: int,
    body: ImageSetUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ImageSetOut:
    s = await db.get(ImageSet, imageset_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    if body.name is not None:
        s.name = body.name.strip()
    if body.group is not None:
        s.group = body.group
    if body.action is not None:
        s.action = body.action
        s.kind = (
            ImageSetKind.BLACKLIST
            if body.action in (ImageSetAction.BLOCK, ImageSetAction.REVIEW, ImageSetAction.TAG)
            else ImageSetKind.WHITELIST
        )
    if body.description is not None:
        s.description = body.description
    if body.is_active is not None:
        s.is_active = body.is_active
    await db.flush()
    await db.refresh(s)
    await db.commit()
    return _to_out(s)


@router.delete("/{imageset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_imageset(
    imageset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    s = (
        await db.execute(
            select(ImageSet).where(ImageSet.id == imageset_id).options(selectinload(ImageSet.items))
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    # 先删磁盘文件
    for it in list(s.items):
        try:
            storage.delete_object(it.storage_key)
        except Exception:  # noqa: BLE001
            pass
    await db.delete(s)
    await db.flush()
    await db.commit()


@router.delete(
    "/{imageset_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_item(
    imageset_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    it = await db.get(ImageSetItem, item_id)
    if not it or it.set_id != imageset_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="图片不存在")
    try:
        storage.delete_object(it.storage_key)
    except Exception:  # noqa: BLE001
        pass
    await db.delete(it)
    await db.flush()
    s = await db.get(ImageSet, imageset_id)
    if s is not None:
        s.item_count = max(0, (s.item_count or 0) - 1)
        await db.flush()
    await db.commit()


@router.post("/{imageset_id}/ignore", response_model=IgnoreToggleResponse)
async def toggle_ignore(
    imageset_id: int,
    body: IgnoreToggleRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> IgnoreToggleResponse:
    s = await db.get(ImageSet, imageset_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    services = list(s.ignored_services or [])
    if body.enabled and body.service_code not in services:
        services.append(body.service_code)
    if not body.enabled and body.service_code in services:
        services.remove(body.service_code)
    s.ignored_services = services
    await db.flush()
    await db.refresh(s)
    await db.commit()
    return IgnoreToggleResponse(ignored_services=services)


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
