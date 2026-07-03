"""Wordset router: CRUD for custom text datasets (group + action)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.wordset import WordSet, WordSetAction, WordSetGroup, WordSetKind
from app.schemas.common import Page
from app.schemas.wordset import WordSetCreate, WordSetOut, WordSetUpdate

router = APIRouter(prefix="/wordsets", tags=["wordsets"])


def _split_words(text: Optional[str]) -> List[str]:
    if not text:
        return []
    out: List[str] = []
    for line in text.splitlines():
        w = line.strip()
        if w:
            out.append(w)
    return out


def _to_out(ws: WordSet) -> WordSetOut:
    words = _split_words(ws.words_text)
    return WordSetOut.model_validate(
        {
            "id": ws.id,
            "code": ws.code,
            "name": ws.name,
            "group": ws.group,
            "action": ws.action,
            "kind": ws.kind,
            "description": ws.description,
            "is_active": ws.is_active,
            "word_count": len(words),
            "ignored_services": list(ws.ignored_services or []),
            "created_at": ws.created_at,
            "updated_at": ws.updated_at,
        }
    )


import re as _re

_CODE_RE = _re.compile(r"^ws_\d+$")


async def _next_ws_code(db: AsyncSession) -> str:
    result = await db.execute(select(WordSet.code))
    used = {row[0] for row in result.all()}
    n = 1
    while f"ws_{n}" in used:
        n += 1
    return f"ws_{n}"


@router.get("", response_model=Page[WordSetOut])
async def list_wordsets(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    group: Optional[WordSetGroup] = None,
    action: Optional[WordSetAction] = None,
    kind: Optional[WordSetKind] = None,  # legacy
    q: Optional[str] = None,
) -> Page[WordSetOut]:
    stmt = select(WordSet)
    conds = []
    if group:
        conds.append(WordSet.group == group)
    if action:
        conds.append(WordSet.action == action)
    if kind and not group and not action:  # 旧客户端仅传 kind 时兼容
        from sqlalchemy import or_ as _or

        conds.append(
            _or(WordSet.action == ("黑名单" if kind == WordSetKind.BLACKLIST else "白名单"))
        )
    if q:
        conds.append(or_(WordSet.name.ilike(f"%{q}%"), WordSet.code.ilike(f"%{q}%")))
    if conds:
        stmt = stmt.where(and_(*conds))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(WordSet.id.desc()).offset((page - 1) * size).limit(size)
    items = [_to_out(s) for s in (await db.execute(stmt)).scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/{wordset_id}", response_model=WordSetOut)
async def get_wordset(
    wordset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> WordSetOut:
    ws = await db.get(WordSet, wordset_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    return _to_out(ws)


@router.get("/{wordset_id}/words", response_model=dict)
async def get_wordset_words(
    wordset_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    ws = await db.get(WordSet, wordset_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    return {"items": _split_words(ws.words_text)}


@router.post("", response_model=WordSetOut, status_code=status.HTTP_201_CREATED)
async def create_wordset(
    body: WordSetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WordSetOut:
    if body.code:
        if not _CODE_RE.match(body.code):
            raise HTTPException(status_code=400, detail="code 必须以 ws_ 开头后接数字")
        existing = await db.execute(select(WordSet).where(WordSet.code == body.code))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="code 已存在")
        code = body.code
    else:
        code = await _next_ws_code(db)
    # 同步把 kind 字段填为 action 兼容值（保留字段用于审计）
    legacy_kind = (
        WordSetKind.BLACKLIST
        if body.action in (WordSetAction.BLOCK, WordSetAction.REVIEW, WordSetAction.TAG)
        else WordSetKind.WHITELIST
    )
    ws = WordSet(
        code=code,
        name=body.name,
        group=body.group,
        action=body.action,
        kind=legacy_kind,
        description=body.description,
        words_text="\n".join(body.words) if body.words else None,
        is_active=True,
        ignored_services=[],
    )
    db.add(ws)
    await db.flush()
    await db.refresh(ws)
    await db.commit()
    return _to_out(ws)


@router.put("/{wordset_id}", response_model=WordSetOut)
async def update_wordset(
    wordset_id: int,
    body: WordSetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WordSetOut:
    ws = await db.get(WordSet, wordset_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    if body.name is not None:
        ws.name = body.name
    if body.group is not None:
        ws.group = body.group
    if body.action is not None:
        ws.action = body.action
        ws.kind = (
            WordSetKind.BLACKLIST
            if body.action in (WordSetAction.BLOCK, WordSetAction.REVIEW, WordSetAction.TAG)
            else WordSetKind.WHITELIST
        )
    if body.description is not None:
        ws.description = body.description
    if body.is_active is not None:
        ws.is_active = body.is_active
    if body.words is not None:
        if len(body.words) > 1000:
            raise HTTPException(status_code=400, detail="单次最多 1000 个敏感词")
        ws.words_text = "\n".join(w for w in (s.strip() for s in body.words) if w) or None
    await db.flush()
    await db.refresh(ws)
    await db.commit()
    return _to_out(ws)


@router.delete("/{wordset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wordset(
    wordset_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    ws = await db.get(WordSet, wordset_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    await db.delete(ws)
    await db.flush()
    await db.commit()


class IgnoreToggleRequest(BaseModel):
    service_code: str
    enabled: bool


class IgnoreToggleResponse(BaseModel):
    ignored_services: list[str]


@router.post("/{wordset_id}/ignore", response_model=IgnoreToggleResponse)
async def toggle_ignore(
    wordset_id: int,
    body: IgnoreToggleRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> IgnoreToggleResponse:
    ws = await db.get(WordSet, wordset_id)
    if not ws:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="数据集不存在")
    services = list(ws.ignored_services or [])
    if body.enabled and body.service_code not in services:
        services.append(body.service_code)
    if not body.enabled and body.service_code in services:
        services.remove(body.service_code)
    ws.ignored_services = services
    await db.flush()
    await db.refresh(ws)
    await db.commit()
    return IgnoreToggleResponse(ignored_services=services)
