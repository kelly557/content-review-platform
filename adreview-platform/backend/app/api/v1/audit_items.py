"""AuditItem router (审核项 CRUD + suggest)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.models.service import Service
from app.models.user import User
from app.schemas.audit_item import (
    AuditItemCreate,
    AuditItemOut,
    AuditItemUpdate,
    ItemSuggestion,
    SuggestResponse,
)
from app.services.nl_match import suggest_items


# 内置审核项允许修改的字段白名单（仅允许启停 + 描述）。
BUILTIN_ITEM_WRITABLE_FIELDS = frozenset({"is_enabled", "description"})


def _filter_payload_for_builtin_item(item: AuditItem, body: AuditItemUpdate) -> None:
    """对「内置审核项」的更新请求拦截非白名单字段（含 aliases / sort_order / name_cn）。"""
    if not item.is_builtin:
        return
    fields_set = getattr(body, "model_fields_set", set())
    blocked = sorted(k for k in fields_set if k not in BUILTIN_ITEM_WRITABLE_FIELDS)
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "通用审核项不允许修改字段："
                + "、".join(blocked)
                + "；仅允许启停 / 调整描述。"
            ),
        )

router = APIRouter(prefix="/packages", tags=["audit-items"])


MEDIA_BY_PACKAGE = {
    "image_audit_pro": "image",
    "text_audit_pro": "text",
    "audio_audit_pro": "audio",
    "document_audit_pro": "doc",
    "video_audit_pro": "video",
}


async def _ensure_package(db: AsyncSession, code: str) -> Service:
    result = await db.execute(select(Service).where(Service.code == code))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则包不存在")
    return svc


async def _generate_item_code(db: AsyncSession, package_code: str) -> str:
    """Generate a unique audit item code: ai_{n+1} within the package.

    Concurrent safety: relies on the (package_code, code) UniqueConstraint
    to surface a 409 if two requests race to the same n.
    """
    count_stmt = select(func.count(AuditItem.id)).where(
        AuditItem.package_code == package_code,
    )
    total = (await db.execute(count_stmt)).scalar_one() or 0
    return f"ai_{total + 1}"


async def _point_counts(db: AsyncSession, package_code: str) -> dict[int, int]:
    result = await db.execute(
        select(AuditPoint.item_id, func.count(AuditPoint.id))
        .where(AuditPoint.package_code == package_code)
        .group_by(AuditPoint.item_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


@router.get("/by-media-type/{media_type}", response_model=list[AuditItemOut])
async def list_items_by_media_type(
    media_type: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[AuditItemOut]:
    """列出某个媒体类型下的所有业务规则 (audit_item).

    例如 media_type=image → 返回 image_audit_pro 服务下所有 item（涉政/涉黄/...）。
    """
    packages = [
        pkg for pkg, m in MEDIA_BY_PACKAGE.items() if m == media_type
    ]
    if not packages:
        return []

    items_result = await db.execute(
        select(AuditItem).where(AuditItem.package_code.in_(packages))
    )
    rows = list(items_result.scalars())
    counts_per_pkg: dict[str, dict[int, int]] = {}
    for pkg in packages:
        counts_per_pkg[pkg] = await _point_counts(db, pkg)

    return [
        AuditItemOut(
            id=r.id,
            package_code=r.package_code,
            code=r.code,
            name_cn=r.name_cn,
            aliases=list(r.aliases or []),
            description=r.description,
            sort_order=r.sort_order,
            is_enabled=r.is_enabled,
            is_builtin=r.is_builtin,
            point_count=counts_per_pkg.get(r.package_code, {}).get(r.id, 0),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.get("/{code}/items", response_model=list[AuditItemOut])
async def list_items(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    enabled: Optional[bool] = None,
    q: Optional[str] = None,
) -> list[AuditItemOut]:
    await _ensure_package(db, code)
    stmt = select(AuditItem).where(AuditItem.package_code == code)
    if enabled is not None:
        stmt = stmt.where(AuditItem.is_enabled.is_(enabled))
    if q:
        stmt = stmt.where(AuditItem.name_cn.ilike(f"%{q}%"))
    stmt = stmt.order_by(AuditItem.sort_order.asc(), AuditItem.id.asc())
    rows = list((await db.execute(stmt)).scalars())
    counts = await _point_counts(db, code)
    return [
        AuditItemOut(
            id=r.id,
            package_code=r.package_code,
            code=r.code,
            name_cn=r.name_cn,
            aliases=list(r.aliases or []),
            description=r.description,
            sort_order=r.sort_order,
            is_enabled=r.is_enabled,
            is_builtin=r.is_builtin,
            point_count=counts.get(r.id, 0),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("/{code}/items", response_model=AuditItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(
    code: str,
    body: AuditItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> AuditItemOut:
    await _ensure_package(db, code)
    generated_code = await _generate_item_code(db, code)
    item = AuditItem(
        package_code=code,
        code=generated_code,
        name_cn=body.name_cn,
        aliases=body.aliases,
        description=body.description,
        sort_order=body.sort_order,
        is_enabled=body.is_enabled,
        is_builtin=False,
    )
    db.add(item)
    try:
        await db.flush()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="审核项编码生成冲突，请重试",
        )
    await db.refresh(item)
    await db.commit()
    return AuditItemOut(
        id=item.id,
        package_code=item.package_code,
        code=item.code,
        name_cn=item.name_cn,
        aliases=list(item.aliases or []),
        description=item.description,
        sort_order=item.sort_order,
        is_enabled=item.is_enabled,
        is_builtin=item.is_builtin,
        point_count=0,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.put("/{code}/items/{item_id}", response_model=AuditItemOut)
async def update_item(
    code: str,
    item_id: int,
    body: AuditItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> AuditItemOut:
    await _ensure_package(db, code)
    item = await db.get(AuditItem, item_id)
    if not item or item.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在")
    _filter_payload_for_builtin_item(item, body)
    if body.name_cn is not None:
        item.name_cn = body.name_cn
    if body.aliases is not None:
        item.aliases = body.aliases
    if body.description is not None:
        item.description = body.description
    if body.sort_order is not None:
        item.sort_order = body.sort_order
    if body.is_enabled is not None:
        item.is_enabled = body.is_enabled
    await db.flush()
    await db.refresh(item)
    await db.commit()
    counts = await _point_counts(db, code)
    return AuditItemOut(
        id=item.id,
        package_code=item.package_code,
        code=item.code,
        name_cn=item.name_cn,
        aliases=list(item.aliases or []),
        description=item.description,
        sort_order=item.sort_order,
        is_enabled=item.is_enabled,
        is_builtin=item.is_builtin,
        point_count=counts.get(item.id, 0),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.delete("/{code}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    code: str,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> None:
    await _ensure_package(db, code)
    item = await db.get(AuditItem, item_id)
    if not item or item.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在")
    if item.is_builtin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项不允许删除。",
        )
    points = await db.execute(
        select(func.count(AuditPoint.id)).where(AuditPoint.item_id == item_id)
    )
    if (points.scalar() or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该审核项下仍有审核点，请先删除审核点",
        )
    await db.delete(item)
    await db.commit()


@router.get("/{code}/items/suggest", response_model=SuggestResponse)
async def suggest_get(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    q: str = Query(..., min_length=1),
    top_k: int = Query(5, ge=1, le=20),
) -> SuggestResponse:
    return await _suggest_impl(db, code, q, top_k)


@router.post("/{code}/items/suggest", response_model=SuggestResponse)
async def suggest_post(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    body: Optional[dict] = None,
    q: Optional[str] = Query(None),
    top_k: int = Query(5, ge=1, le=20),
) -> SuggestResponse:
    payload = body or {}
    text = q or payload.get("q") or ""
    tk = payload.get("top_k", top_k)
    return await _suggest_impl(db, code, text, int(tk))


async def _suggest_impl(
    db: AsyncSession, code: str, query: str, top_k: int
) -> SuggestResponse:
    await _ensure_package(db, code)
    scored = await suggest_items(db, package_code=code, query=query, top_k=top_k)
    matches = [
        ItemSuggestion(
            item_id=s.item.id,
            item_code=s.item.code,
            item_name_cn=s.item.name_cn,
            score=s.score,
            matched_aliases=s.matched_aliases,
            matched_terms=s.matched_terms,
        )
        for s in scored
    ]
    return SuggestResponse(matches=matches, mock=True, engine="mock-v1")