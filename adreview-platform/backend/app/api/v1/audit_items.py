"""AuditItem router (审核项 CRUD + suggest)."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_item import AuditItem
from app.models.audit_item_library import AuditItemLibrary
from app.models.audit_point import AuditPoint
from app.models.library import Library
from app.models.registered_model import (
    RegisteredModel,
    RegisteredModelStatus,
    RegisteredModelVersion,
    RegisteredModelVersionStatus,
)
from app.models.service import Service
from app.models.user import User, UserRole
from app.schemas.audit_item import (
    ActiveModelVersionOut,
    AuditItemCreate,
    AuditItemOut,
    AuditItemUpdate,
    LinkedLibraryOut,
    ItemSuggestion,
    SuggestResponse,
)
from app.services.nl_match import suggest_items

logger = logging.getLogger(__name__)


# 内置审核项允许修改的字段白名单。
# 允许启停 + 描述 + 关联自定义库 + 切换生效模型版本。
BUILTIN_ITEM_WRITABLE_FIELDS = frozenset(
    {"is_enabled", "description", "linked_library_ids", "active_large_model_version_id"}
)


def _filter_payload_for_builtin_item(
    item: AuditItem, body: AuditItemUpdate, user: User
) -> None:
    """对「内置审核项」的更新请求拦截非白名单字段。

    通用规则（is_builtin=True）仅允许在白名单内的字段生效。超级管理员不受限制。
    """
    if not item.is_builtin:
        return
    if user.role == UserRole.SUPERADMIN:
        return
    fields_set = getattr(body, "model_fields_set", set())
    blocked = sorted(k for k in fields_set if k not in BUILTIN_ITEM_WRITABLE_FIELDS)
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "通用审核项不允许修改字段："
                + "、".join(blocked)
                + "；仅允许启停 / 调整描述 / 关联自定义图库词库 / 切换生效模型版本"
                "（超级管理员可改任意字段）。"
            ),
        )


def _enforce_mutual_exclusion(item: AuditItem, body: AuditItemUpdate) -> None:
    """通用 ↔ 个性化 字段互斥校验。

    - is_builtin=True 携带 ``knowledge_document_ids`` → 422
    - is_builtin=False 携带 ``active_large_model_version_id`` → 422
    """
    fields_set = getattr(body, "model_fields_set", set())
    if item.is_builtin and "knowledge_document_ids" in fields_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项不支持关联知识文档",
        )
    if not item.is_builtin and "active_large_model_version_id" in fields_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="个性化审核项不支持切换生效模型版本",
        )


async def _validate_active_model_version(
    db: AsyncSession, version_id: Optional[int]
) -> Optional[RegisteredModelVersion]:
    """校验 active_large_model_version_id 指向一个 active 大模型版本。

    - None → 允许（清空）
    - int → 必须存在且 version.status='active' + parent model.status='active'
    """
    if version_id is None:
        return None
    version = await db.get(RegisteredModelVersion, version_id)
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"active_large_model_version_id 引用的版本不存在: {version_id}",
        )
    if version.status != RegisteredModelVersionStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"active_large_model_version_id 引用的版本未启用 "
                f"(status={version.status})"
            ),
        )
    parent = await db.get(RegisteredModel, version.model_id)
    if parent is None or parent.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"active_large_model_version_id 引用的模型不存在或已删除",
        )
    if parent.status != RegisteredModelStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"active_large_model_version_id 引用的模型未启用 "
                f"(status={parent.status})"
            ),
        )
    if parent.kind != "large":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="active_large_model_version_id 必须指向大模型版本（kind=large）",
        )
    return version


async def _resolve_active_model_version(
    db: AsyncSession, item: AuditItem
) -> Optional[ActiveModelVersionOut]:
    """加载 item.active_large_model_version_id 对应的展示对象。"""
    if item.active_large_model_version_id is None:
        return None
    version = await db.get(RegisteredModelVersion, item.active_large_model_version_id)
    if version is None:
        return None
    parent = await db.get(RegisteredModel, version.model_id)
    if parent is None:
        return None
    return ActiveModelVersionOut(
        version_id=version.id,
        model_id=parent.id,
        model_code=parent.code,
        model_name=parent.name,
        version_no=version.version_no,
        version_label=version.version_label,
    )


async def _replace_item_linked_libraries(
    db: AsyncSession,
    item: AuditItem,
    library_ids: Optional[list[int]],
) -> None:
    """PATCH semantics for audit_item_libraries join rows.

    PATCH semantics (与 audit_points 端同等)：
    - library_ids is None  → 不动
    - library_ids == []    → 清空该 item 所有关联
    - library_ids == [非空]  → 校验 ID 存在 + 类型一致 → 全量替换
    """
    if library_ids is None:
        return

    if library_ids:
        unique_ids: list[int] = []
        seen: set[int] = set()
        for lid in library_ids:
            if lid in seen:
                continue
            seen.add(lid)
            unique_ids.append(lid)

        rows = await db.execute(
            select(Library.id, Library.library_type).where(Library.id.in_(unique_ids))
        )
        found = rows.all()
        found_ids = {r[0] for r in found}
        missing = set(unique_ids) - found_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"linked_libraries: libraries not found: {sorted(missing)}",
            )

        types = {r[1] for r in found}
        if len(types) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "linked_libraries must share a single library_type; got "
                    + ", ".join(
                        sorted(
                            t.value if hasattr(t, "value") else str(t)
                            for t in types
                        )
                    )
                ),
            )

    await db.execute(
        delete(AuditItemLibrary).where(
            AuditItemLibrary.audit_item_id == item.id
        )
    )
    if library_ids:
        unique_ids: list[int] = []
        seen = set()
        for lid in library_ids:
            if lid in seen:
                continue
            seen.add(lid)
            unique_ids.append(lid)
        await db.execute(
            insert(AuditItemLibrary).values(
                [
                    {"audit_item_id": item.id, "library_id": lid}
                    for lid in unique_ids
                ]
            )
        )


def _serialize_item_libraries(item: AuditItem) -> list[LinkedLibraryOut]:
    """Build the LinkedLibraryOut list for an audit item."""
    links = getattr(item, "linked_library_links", None)
    libs = getattr(item, "linked_libraries", None)
    if not isinstance(links, list) or not isinstance(libs, list):
        return []
    by_id = {lib.id: lib for lib in libs}
    out: list[LinkedLibraryOut] = []
    for link in links:
        lib = by_id.get(link.library_id)
        if lib is None:
            continue
        out.append(
            LinkedLibraryOut(
                library_id=lib.id,
                library_type=(
                    lib.library_type.value
                    if hasattr(lib.library_type, "value")
                    else str(lib.library_type)
                ),
                code=lib.code,
                name=lib.name,
                group_id=getattr(lib, "group_id", None),
                group_name=None,
                sort_order=link.sort_order,
            )
        )
    return out

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
        select(AuditItem)
        .where(AuditItem.package_code.in_(packages))
        .options(
            selectinload(AuditItem.linked_library_links),
            selectinload(AuditItem.linked_libraries),
        )
    )
    rows = list(items_result.scalars())
    counts_per_pkg: dict[str, dict[int, int]] = {}
    for pkg in packages:
        counts_per_pkg[pkg] = await _point_counts(db, pkg)

    out: list[AuditItemOut] = []
    for r in rows:
        active = await _resolve_active_model_version(db, r)
        out.append(
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
                linked_libraries=_serialize_item_libraries(r),
                active_large_model_version_id=r.active_large_model_version_id,
                active_model_version=active,
                knowledge_document_ids=list(r.knowledge_document_ids or []),
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )
    return out


@router.get("/{code}/items", response_model=list[AuditItemOut])
async def list_items(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    enabled: Optional[bool] = None,
    q: Optional[str] = None,
) -> list[AuditItemOut]:
    await _ensure_package(db, code)
    stmt = (
        select(AuditItem)
        .where(AuditItem.package_code == code)
        .options(
            selectinload(AuditItem.linked_library_links),
            selectinload(AuditItem.linked_libraries),
        )
    )
    if enabled is not None:
        stmt = stmt.where(AuditItem.is_enabled.is_(enabled))
    if q:
        stmt = stmt.where(AuditItem.name_cn.ilike(f"%{q}%"))
    stmt = stmt.order_by(AuditItem.sort_order.asc(), AuditItem.id.asc())
    rows = list((await db.execute(stmt)).scalars())
    counts = await _point_counts(db, code)
    out: list[AuditItemOut] = []
    for r in rows:
        active = await _resolve_active_model_version(db, r)
        out.append(
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
                linked_libraries=_serialize_item_libraries(r),
                active_large_model_version_id=r.active_large_model_version_id,
                active_model_version=active,
                knowledge_document_ids=list(r.knowledge_document_ids or []),
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )
    return out


@router.post("/{code}/items", response_model=AuditItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(
    code: str,
    body: AuditItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
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
        knowledge_document_ids=list(body.knowledge_document_ids or []),
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
    if body.linked_library_ids is not None:
        await _replace_item_linked_libraries(db, item, body.linked_library_ids)
    await db.commit()

    fresh = (
        await db.execute(
            select(AuditItem)
            .where(AuditItem.id == item.id)
            .options(
                selectinload(AuditItem.linked_library_links),
                selectinload(AuditItem.linked_libraries),
            )
        )
    ).scalar_one()
    return AuditItemOut(
        id=fresh.id,
        package_code=fresh.package_code,
        code=fresh.code,
        name_cn=fresh.name_cn,
        aliases=list(fresh.aliases or []),
        description=fresh.description,
        sort_order=fresh.sort_order,
        is_enabled=fresh.is_enabled,
        is_builtin=fresh.is_builtin,
        point_count=0,
        linked_libraries=_serialize_item_libraries(fresh),
        active_large_model_version_id=None,
        active_model_version=None,
        knowledge_document_ids=list(fresh.knowledge_document_ids or []),
        created_at=fresh.created_at,
        updated_at=fresh.updated_at,
    )


@router.put("/{code}/items/{item_id}", response_model=AuditItemOut)
async def update_item(
    code: str,
    item_id: int,
    body: AuditItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> AuditItemOut:
    await _ensure_package(db, code)
    item = await db.get(AuditItem, item_id)
    if not item or item.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在")
    _filter_payload_for_builtin_item(item, body, current_user)
    _enforce_mutual_exclusion(item, body)
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
    if body.linked_library_ids is not None:
        await _replace_item_linked_libraries(db, item, body.linked_library_ids)
    if body.active_large_model_version_id is not None:
        await _validate_active_model_version(db, body.active_large_model_version_id)
        item.active_large_model_version_id = body.active_large_model_version_id
    if body.knowledge_document_ids is not None:
        item.knowledge_document_ids = list(body.knowledge_document_ids)
    await db.flush()
    await db.commit()

    fresh = (
        await db.execute(
            select(AuditItem)
            .where(AuditItem.id == item.id)
            .options(
                selectinload(AuditItem.linked_library_links),
                selectinload(AuditItem.linked_libraries),
            )
        )
    ).scalar_one()
    counts = await _point_counts(db, code)
    active = await _resolve_active_model_version(db, fresh)
    return AuditItemOut(
        id=fresh.id,
        package_code=fresh.package_code,
        code=fresh.code,
        name_cn=fresh.name_cn,
        aliases=list(fresh.aliases or []),
        description=fresh.description,
        sort_order=fresh.sort_order,
        is_enabled=fresh.is_enabled,
        is_builtin=fresh.is_builtin,
        point_count=counts.get(fresh.id, 0),
        linked_libraries=_serialize_item_libraries(fresh),
        active_large_model_version_id=fresh.active_large_model_version_id,
        active_model_version=active,
        knowledge_document_ids=list(fresh.knowledge_document_ids or []),
        created_at=fresh.created_at,
        updated_at=fresh.updated_at,
    )


@router.delete("/{code}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    code: str,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> None:
    await _ensure_package(db, code)
    item = await db.get(AuditItem, item_id)
    if not item or item.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在")
    if item.is_builtin and current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项不允许删除;仅超级管理员可操作。",
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