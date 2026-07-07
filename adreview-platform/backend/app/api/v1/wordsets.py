"""Legacy wordsets API — compatibility shim over /libraries.

Behavior:
- list: maps to libraries(type='word'); legacy group+action filters map to
  a free-text ``q`` (best-effort) plus an extra hidden in-memory filter.
- create: creates a Library(library_type=WORD) under a single auto-group
  named "默认分组" if no library_group exists.
- update: same.
- delete: soft-delete; if no audit_point references, defaults to force=true.

All endpoints emit the legacy WordSetOut schema. They are deprecated — the
canonical endpoint is /api/v1/libraries.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.audit_point import AuditPoint
from app.models.library import Library, LibraryType
from app.models.library_group import LibraryGroup
from app.models.library_item import LibraryItem
from app.models.user import User
from app.schemas.common import Page
from app.schemas.wordset import WordSetCreate, WordSetOut, WordSetUpdate

router = APIRouter(prefix="/wordsets", tags=["wordsets"])

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


def _to_legacy_out(
    lib: Library, words_count: int, ignored: List[str]
) -> WordSetOut:
    return WordSetOut.model_validate(
        {
            "id": lib.id,
            "code": lib.code,
            "name": lib.name,
            "group": "关键词",
            "action": "黑名单",
            "kind": "黑名单",
            "description": lib.description,
            "is_active": lib.is_active,
            "word_count": words_count,
            "ignored_services": ignored,
            "created_at": lib.created_at,
            "updated_at": lib.updated_at,
        }
    )


async def _word_count(db: AsyncSession, lib_id: int) -> int:
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


@router.get("", response_model=Page[WordSetOut])
async def list_wordsets(
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
        and_(Library.library_type == LibraryType.WORD, Library.is_deleted == False)  # noqa: E712
    )
    if q:
        stmt = stmt.where(or_(Library.name.ilike(f"%{q}%"), Library.code.ilike(f"%{q}%")))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(Library.id.desc()).offset((page - 1) * size).limit(size)
    libs = list((await db.execute(stmt)).scalars())
    items = [
        _to_legacy_out(l, await _word_count(db, l.id), list(l.ignored_services or []))
        for l in libs
    ]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/{wordset_id}", response_model=WordSetOut)
async def get_wordset(
    wordset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, wordset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.WORD:
        raise HTTPException(status_code=404, detail="数据集不存在")
    return _to_legacy_out(lib, await _word_count(db, lib.id), list(lib.ignored_services or []))


@router.get("/{wordset_id}/words", response_model=dict)
async def get_wordset_words(
    wordset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, wordset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.WORD:
        raise HTTPException(status_code=404, detail="数据集不存在")
    rows = await db.execute(
        select(LibraryItem.word).where(
            and_(
                LibraryItem.library_id == lib.id,
                LibraryItem.is_deleted == False,  # noqa: E712
            )
        )
    )
    return {"items": [r[0] for r in rows.all() if r[0]]}


@router.post("", response_model=WordSetOut, status_code=201)
async def create_wordset(
    body: WordSetCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    grp = await _ensure_default_group(db)
    code = body.code
    if not code:
        result = await db.execute(select(Library.code).where(Library.code.like("ws_%")))
        used = {row[0] for row in result.all()}
        n = 1
        while f"ws_{n}" in used:
            n += 1
        code = f"ws_{n}"

    lib = Library(
        code=code,
        name=body.name.strip(),
        library_type=LibraryType.WORD,
        group_id=grp.id,
        description=body.description,
        is_active=True,
        ignored_services=[],
    )
    db.add(lib)
    await db.flush()

    seen: set[str] = set()
    for w in body.words or []:
        w = (w or "").strip()
        if not w or w in seen:
            continue
        seen.add(w)
        db.add(LibraryItem(library_id=lib.id, word=w))
    await db.flush()
    await db.refresh(lib)
    await db.commit()
    return _to_legacy_out(lib, await _word_count(db, lib.id), [])


@router.put("/{wordset_id}", response_model=WordSetOut)
async def update_wordset(
    wordset_id: int,
    body: WordSetUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, wordset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.WORD:
        raise HTTPException(status_code=404, detail="数据集不存在")
    if body.name is not None:
        lib.name = body.name.strip()
    if body.description is not None:
        lib.description = body.description
    if body.is_active is not None:
        lib.is_active = body.is_active
    if body.words is not None:
        if len(body.words) > 1000:
            raise HTTPException(status_code=400, detail="单次最多 1000 个敏感词")
        await db.execute(
            LibraryItem.__table__.delete().where(LibraryItem.library_id == lib.id)
        )
        seen: set[str] = set()
        for w in body.words:
            w = (w or "").strip()
            if not w or w in seen:
                continue
            seen.add(w)
            db.add(LibraryItem(library_id=lib.id, word=w))
    await db.flush()
    await db.refresh(lib)
    await db.commit()
    return _to_legacy_out(lib, await _word_count(db, lib.id), list(lib.ignored_services or []))


@router.delete("/{wordset_id}", status_code=204)
async def delete_wordset(
    wordset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, wordset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.WORD:
        raise HTTPException(status_code=404, detail="数据集不存在")
    aps = await db.execute(
        select(AuditPoint).where(AuditPoint.custom_library_id == lib.id)
    )
    for ap in aps.scalars():
        ap.custom_library_id = None
        ap.custom_wordset_id = None
    lib.is_deleted = True
    lib.deleted_at = datetime.utcnow()
    items = (
        await db.execute(
            select(LibraryItem).where(LibraryItem.library_id == lib.id)
        )
    ).scalars()
    for it in list(items):
        it.is_deleted = True
        it.deleted_at = datetime.utcnow()
    await db.flush()
    await db.commit()


class _IgnoreRequest(BaseModel):
    service_code: str
    enabled: bool


class _IgnoreResponse(BaseModel):
    ignored_services: List[str]


@router.post("/{wordset_id}/ignore", response_model=_IgnoreResponse)
async def toggle_ignore(
    wordset_id: int,
    body: _IgnoreRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    lib = await db.get(Library, wordset_id)
    if not lib or lib.is_deleted or lib.library_type != LibraryType.WORD:
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