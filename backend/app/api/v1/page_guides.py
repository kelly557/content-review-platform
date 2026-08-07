"""PageGuide API — server-side override of the frontend prototype guide.

Endpoints
---------
  GET    /api/v1/page-guides                       list all overrides
  GET    /api/v1/page-guides/{path:path}           get one (404 if absent)
  PUT    /api/v1/page-guides/{path:path}           upsert one (any logged-in user)
  DELETE /api/v1/page-guides/{path:path}           delete override (any logged-in user)

The "any logged-in user" policy is by design — the prototype guide is meant
to be a shared, self-serve knowledge surface, not a privileged config. The
``updated_by_id`` column records who last touched each row for transparency.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.page_guide import PageGuide
from app.models.user import User
from app.schemas.page_guide import (
    MAX_MARKDOWN_BYTES,
    PageGuideListOut,
    PageGuideOut,
    PageGuideUpsertIn,
)

router = APIRouter(prefix="/page-guides", tags=["page-guides"])


def _to_out(row: PageGuide) -> PageGuideOut:
    return PageGuideOut(
        path=row.path,
        title=row.title,
        markdown_md=row.markdown_md,
        updated_by_id=row.updated_by_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("", response_model=PageGuideListOut)
async def list_guides(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PageGuideListOut:
    result = await db.execute(
        select(PageGuide).order_by(PageGuide.updated_at.desc())
    )
    rows = result.scalars().all()
    return PageGuideListOut(guides=[_to_out(r) for r in rows])


@router.get("/{path:path}", response_model=PageGuideOut)
async def get_guide(
    path: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PageGuideOut:
    full_path = _normalize_path(path)
    row = await db.get(PageGuide, full_path)
    if row is None:
        raise HTTPException(status_code=404, detail="page guide not found")
    return _to_out(row)


@router.put("/{path:path}", response_model=PageGuideOut)
async def upsert_guide(
    path: str,
    body: PageGuideUpsertIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PageGuideOut:
    full_path = _normalize_path(path)
    if not body.markdown_md.strip():
        raise HTTPException(status_code=400, detail="markdown_md 不能为空")
    if len(body.markdown_md.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise HTTPException(status_code=400, detail="内容超过 100KB 上限")

    row = await db.get(PageGuide, full_path)
    if row is None:
        row = PageGuide(
            path=full_path,
            title=body.title,
            markdown_md=body.markdown_md,
            updated_by_id=user.id,
        )
        db.add(row)
    else:
        row.title = body.title
        row.markdown_md = body.markdown_md
        row.updated_by_id = user.id

    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/{path:path}", status_code=204)
async def delete_guide(
    path: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    full_path = _normalize_path(path)
    row = await db.get(PageGuide, full_path)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=204)


def _normalize_path(path: str) -> str:
    """FastAPI's ``{path:path}`` strips the leading ``/``; re-attach it so the
    stored value matches the frontend's ``location.pathname`` exactly. Also
    enforce a basic length cap to match the column's VARCHAR(255)."""
    if not path:
        raise HTTPException(status_code=400, detail="path 不能为空")
    full = "/" + path.lstrip("/")
    if len(full) > 255:
        raise HTTPException(status_code=400, detail="path 过长")
    return full
