"""Tag management API — CRUD + 三级级联 + tree + 反查。

Endpoints
---------
  GET    /api/v1/tags                       list tags (multi-dim filter + level/parent/bound_model)
  POST   /api/v1/tags                       create tag (parent_id / level / bound_model_* 校验)
  GET    /api/v1/tags/{id}                  detail
  PUT    /api/v1/tags/{id}                  update tag
  DELETE /api/v1/tags/{id}                  delete tag (soft delete; 级联删子标签 by FK CASCADE)
  POST   /api/v1/tags/{id}/activate         flip status active
  POST   /api/v1/tags/{id}/deprecate        flip status deprecated

  GET    /api/v1/tags/tree                  完整三级树（前端 Cascader/Tree 渲染）
  GET    /api/v1/tags/references            反查：哪些三级标签绑定了 model_id
"""
from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.tag import (
    TAG_LEVEL_LEAF,
    TagDomain,
    TagStatus,
)
from app.models.user import User
from app.schemas.common import Page
from app.schemas.tag import (
    TagCreate,
    TagOut,
    TagReferenceList,
    TagReferencesResponse,
    TagSummary,
    TagTreeNode,
    TagUpdate,
)
from app.services import tag as tag_service
from app.services.tag import TagReferenceBlockError, TagValidationError

router = APIRouter(prefix="/tags", tags=["tags"])


_TAG_CODE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]{1,95}$")


async def _next_tag_code(db: AsyncSession) -> str:
    result = await db.execute(select(tag_service.Tag.code))
    used = {row[0] for row in result.all()}
    n = 1
    while f"tag_{n}" in used:
        n += 1
    return f"tag_{n}"


def _to_out(tag) -> TagOut:
    return TagOut.model_validate(tag, from_attributes=True)


def _to_summary(tag) -> TagSummary:
    return TagSummary(
        id=tag.id,
        code=tag.code,
        name=tag.name,
        name_en=tag.name_en,
        domain=tag.domain,
        category=tag.category,
        jurisdictions=list(tag.jurisdictions or []),
        industries=list(tag.industries or []),
        channels=list(tag.channels or []),
        status=tag.status,
        level=tag.level,
        parent_id=tag.parent_id,
        bound_model_id=tag.bound_model_id,
        bound_model_kind=tag.bound_model_kind,
        updated_at=tag.updated_at,
    )


# ─── CRUD ────────────────────────────────────────────────────────────────────


@router.get("", response_model=Page[TagSummary])
async def list_tags(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    domain: Optional[TagDomain] = None,
    category: Optional[str] = None,
    status_: Optional[TagStatus] = Query(None, alias="status"),
    jurisdiction: Optional[List[str]] = Query(None),
    industry: Optional[List[str]] = Query(None),
    channel: Optional[List[str]] = Query(None),
    q: Optional[str] = None,
    level: Optional[int] = Query(None, ge=1, le=3),
    parent_id: Optional[str] = None,
    bound_model_id: Optional[int] = Query(None, ge=1),
):
    items, total = await tag_service.list_tags(
        db,
        page=page,
        size=size,
        domain=domain.value if domain else None,
        category=category,
        status=status_,
        jurisdictions=jurisdiction,
        industries=industry,
        channels=channel,
        q=q,
        level=level,
        parent_id=parent_id,
        bound_model_id=bound_model_id,
    )
    return Page(items=[_to_summary(t) for t in items], total=total, page=page, size=size)


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
async def create_tag(
    body: TagCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    code = body.code
    if not code:
        code = await _next_tag_code(db)
    if not _TAG_CODE_RE.match(code):
        raise HTTPException(
            status_code=400,
            detail="code 必须以字母开头，仅含字母数字下划线短横线，1-96 字符",
        )
    body = body.model_copy(update={"code": code})
    try:
        tag = await tag_service.create_tag(db, body)
    except TagValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    await db.refresh(tag)
    return _to_out(tag)


@router.get("/tree", response_model=List[TagTreeNode])
async def get_tag_tree(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await tag_service.build_tree(db)


@router.get("/references", response_model=TagReferenceList)
async def get_tag_references(
    model_id: int = Query(..., ge=1),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await tag_service.list_references_by_model(db, model_id)


@router.get("/{tag_id}", response_model=TagOut)
async def get_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    include_deleted: bool = Query(False, description="已软删除的标签仍可读（用于审计）"),
):
    tag = await tag_service.get_tag(db, tag_id, include_deleted=include_deleted)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    return _to_out(tag)


@router.put("/{tag_id}", response_model=TagOut)
async def update_tag(
    tag_id: str,
    body: TagUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    tag = await tag_service.get_tag(db, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    try:
        tag = await tag_service.update_tag(db, tag, body)
    except TagValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    await db.refresh(tag)
    return _to_out(tag)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    tag = await tag_service.get_tag(db, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    try:
        await tag_service.delete_tag(db, tag)
    except TagReferenceBlockError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": e.message, "references": e.references.model_dump(mode="json")},
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{tag_id}/activate", response_model=TagOut)
async def activate_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    tag = await tag_service.get_tag(db, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    tag.status = TagStatus.ACTIVE
    tag.version = (tag.version or 1) + 1
    await db.commit()
    await db.refresh(tag)
    return _to_out(tag)


@router.post("/{tag_id}/deprecate", response_model=TagOut)
async def deprecate_tag(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    tag = await tag_service.get_tag(db, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    try:
        return await tag_service.deprecate_tag(db, tag)
    except TagReferenceBlockError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": e.message, "references": e.references.model_dump(mode="json")},
        )


@router.get("/{tag_id}/references", response_model=TagReferencesResponse)
async def get_tag_references(
    tag_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """查询标签被哪些审核策略 / 模型引用,供「停用/删除」前的二次确认使用。

    返回:
      - strategies / models 清单
      - can_deactivate / can_delete:前端根据这两个布尔决定是直接放行还是弹窗
    """
    return await tag_service.build_references_for_tag(db, tag_id)