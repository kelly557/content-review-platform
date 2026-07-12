"""AuditPoint router (审核点 CRUD)."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import delete, func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.models.audit_point_library import AuditPointLibrary
from app.models.library import Library
from app.models.service import Service
from app.models.user import User, UserRole
from app.schemas.audit_point import (
    AuditPointBatchCreate,
    AuditPointBatchItem,
    AuditPointBatchResult,
    AuditPointCreate,
    AuditPointOut,
    AuditPointResetResult,
    AuditPointUpdate,
    serialize_audit_point,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/packages", tags=["audit-points"])


async def _ensure_package(db: AsyncSession, code: str) -> Service:
    result = await db.execute(select(Service).where(Service.code == code))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则包不存在")
    return svc


async def _generate_point_code(db: AsyncSession, package_code: str, item_id: int) -> str:
    """Generate a unique audit point code: ap_{item_id}_{n+1}.

    Concurrent safety: relies on the (package_code, code) UniqueConstraint
    to surface a 409 if two requests race to the same n.
    """
    count_stmt = select(func.count(AuditPoint.id)).where(
        AuditPoint.package_code == package_code,
        AuditPoint.item_id == item_id,
    )
    total = (await db.execute(count_stmt)).scalar_one() or 0
    return f"ap_{item_id}_{total + 1}"


async def _ensure_item_writable(
    db: AsyncSession,
    package_code: str,
    item_id: int,
) -> AuditItem:
    """返回 item 实例，便于调用方读取 is_builtin。"""
    item = await db.get(AuditItem, item_id)
    if not item or item.package_code != package_code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在")
    return item


# 内置审核点允许修改的字段白名单。
# 其余字段（如 label_cn / description / scope_text / risk_level / custom_wordset_id /
# sort_order）由下列 _filter_payload_for_builtin_point 函数在 router 层拦截；
# 即便绕过前端直接请求，也兜底 422。
BUILTIN_POINT_WRITABLE_FIELDS = frozenset(
    {"is_enabled", "medium_threshold", "high_threshold", "linked_library_ids"}
)


def _filter_payload_for_builtin_point(
    point: AuditPoint, body: AuditPointUpdate, user: User
) -> None:
    """对「内置审核点」的更新请求拦截非白名单字段。

    超级管理员不受白名单限制,可任意修改通用审核点的任意字段。
    """
    if not point.is_builtin:
        return
    if user.role == UserRole.SUPERADMIN:
        return
    # Pydantic v2: model_fields_set 记录显式提供字段（含 null）
    fields_set = getattr(body, "model_fields_set", set())
    blocked = sorted(k for k in fields_set if k not in BUILTIN_POINT_WRITABLE_FIELDS)
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "通用审核点不允许修改字段："
                + "、".join(blocked)
                + "；仅允许启用 / 中/高风险分 / 关联自定义库（超级管理员可改任意字段）。"
            ),
        )


async def _replace_linked_libraries(
    db: AsyncSession,
    point: AuditPoint,
    library_ids: Optional[list[int]],
) -> None:
    """PATCH semantics for audit_point_libraries join rows.

    - library_ids is None  → 不动
    - library_ids == []     → 清空该点所有关联
    - library_ids == [非空]  → 校验 ID 存在 + 类型一致 → 全量替换

    Also refreshes the point's `linked_library_links` relationship so the
    response reflects the new state without stale cache.
    """
    if library_ids is None:
        return

    if library_ids:
        # 去重，保持顺序
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
                    f"linked_libraries must share a single library_type; "
                    f"got {sorted(t.value if hasattr(t, 'value') else t for t in types)}"
                ),
            )

    # 全量替换
    await db.execute(
        delete(AuditPointLibrary).where(
            AuditPointLibrary.audit_point_id == point.id
        )
    )
    if library_ids:
        unique_ids = []
        seen = set()
        for lid in library_ids:
            if lid in seen:
                continue
            seen.add(lid)
            unique_ids.append(lid)
        await db.execute(
            insert(AuditPointLibrary).values(
                [
                    {"audit_point_id": point.id, "library_id": lid}
                    for lid in unique_ids
                ]
            )
        )

    # 让 relationship 缓存失效,响应能看到最新行（由外层 commit + refresh）
    pass


@router.get("/{code}/points", response_model=list[AuditPointOut])
async def list_points(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    item_id: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> list[AuditPointOut]:
    from sqlalchemy.orm import selectinload

    await _ensure_package(db, code)
    stmt = (
        select(AuditPoint)
        .where(AuditPoint.package_code == code)
        .options(
            selectinload(AuditPoint.linked_library_links),
            selectinload(AuditPoint.linked_libraries),
        )
    )
    if item_id is not None:
        stmt = stmt.where(AuditPoint.item_id == item_id)
    if enabled is not None:
        stmt = stmt.where(AuditPoint.is_enabled.is_(enabled))
    stmt = stmt.order_by(AuditPoint.item_id.asc(), AuditPoint.sort_order.asc(), AuditPoint.id.asc())
    rows = list((await db.execute(stmt)).scalars())
    return [AuditPointOut.model_validate(serialize_audit_point(r)) for r in rows]


@router.post("/{code}/points", response_model=AuditPointOut, status_code=status.HTTP_201_CREATED)
async def create_point(
    code: str,
    body: AuditPointCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointOut:
    await _ensure_package(db, code)
    item = await _ensure_item_writable(db, code, body.item_id)
    # 通用审核项下不允许新增审核点（无论角色,包括超级管理员）——
    # 约束意图:通用规则由 seed 预置完毕,扩展请新建个性化 item;
    # 此限制在用户确认的范围内保留。
    if item.is_builtin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项下不允许新增审核点；如需扩展，请在知识库新建个性化审核项。",
        )
    generated_code = await _generate_point_code(db, code, body.item_id)
    point = AuditPoint(
        package_code=code,
        item_id=body.item_id,
        code=generated_code,
        label=generated_code,
        label_cn=body.label_cn,
        description=body.description,
        medium_threshold=body.medium_threshold,
        high_threshold=body.high_threshold,
        scope_text=body.scope_text,
        risk_level=body.risk_level,
        is_enabled=body.is_enabled,
        custom_wordset_id=body.custom_wordset_id,
        sort_order=body.sort_order,
    )
    db.add(point)
    try:
        await db.flush()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="审核点编码生成冲突，请重试",
        )
    # linked_libraries
    if body.linked_library_ids is not None:
        await _replace_linked_libraries(db, point, body.linked_library_ids)
        await db.commit()
        db.expire(point, ["linked_library_links", "linked_libraries"])
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        fresh = (
            await db.execute(
                select(AuditPoint)
                .where(AuditPoint.id == point.id)
                .options(
                    selectinload(AuditPoint.linked_library_links),
                    selectinload(AuditPoint.linked_libraries),
                )
            )
        ).scalar_one()
        return AuditPointOut.model_validate(serialize_audit_point(fresh))
    await db.refresh(point)
    await db.commit()
    return AuditPointOut.model_validate(serialize_audit_point(point))


@router.put("/{code}/points/{point_id}", response_model=AuditPointOut)
async def update_point(
    code: str,
    point_id: int,
    body: AuditPointUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointOut:
    await _ensure_package(db, code)
    point = await db.get(AuditPoint, point_id)
    if not point or point.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核点不存在")
    _filter_payload_for_builtin_point(point, body, current_user)
    if body.label_cn is not None:
        point.label_cn = body.label_cn
    if body.description is not None:
        point.description = body.description
    if body.medium_threshold is not None:
        point.medium_threshold = body.medium_threshold
    if body.high_threshold is not None:
        point.high_threshold = body.high_threshold
    if body.scope_text is not None:
        point.scope_text = body.scope_text
    if body.risk_level is not None:
        point.risk_level = body.risk_level
    if body.is_enabled is not None:
        point.is_enabled = body.is_enabled
    if body.custom_wordset_id is not None:
        # 旧列：写入但不进新表；log 一次提示
        logger.warning(
            "audit_point(%s) custom_wordset_id being written via legacy field; "
            "consider migrating to linked_library_ids",
            point.id,
        )
        point.custom_wordset_id = body.custom_wordset_id
    if body.sort_order is not None:
        point.sort_order = body.sort_order
    if body.linked_library_ids is not None:
        await _replace_linked_libraries(db, point, body.linked_library_ids)
        await db.flush()
        await db.commit()
        # 显式 expire 当前 point 的关联，避免 selectin 拿旧 cache
        db.expire(point, ["linked_library_links", "linked_libraries"])
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        fresh = (
            await db.execute(
                select(AuditPoint)
                .where(AuditPoint.id == point.id)
                .options(
                    selectinload(AuditPoint.linked_library_links),
                    selectinload(AuditPoint.linked_libraries),
                )
            )
        ).scalar_one()
        return AuditPointOut.model_validate(serialize_audit_point(fresh))
    await db.flush()
    await db.refresh(point)
    await db.commit()
    return AuditPointOut.model_validate(serialize_audit_point(point))


@router.delete("/{code}/points/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_point(
    code: str,
    point_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> None:
    await _ensure_package(db, code)
    point = await db.get(AuditPoint, point_id)
    if not point or point.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核点不存在")
    if point.is_builtin and current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核点不允许删除;仅超级管理员可操作。",
        )
    await db.delete(point)
    await db.commit()


@router.post("/{code}/points/reset", response_model=AuditPointResetResult)
async def reset_points(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointResetResult:
    from sqlalchemy.orm import selectinload

    await _ensure_package(db, code)
    stmt = (
        select(AuditPoint)
        .where(AuditPoint.package_code == code)
        .options(
            selectinload(AuditPoint.linked_library_links),
            selectinload(AuditPoint.linked_libraries),
        )
    )
    rows = list((await db.execute(stmt)).scalars())
    for p in rows:
        p.medium_threshold = 60.0
        p.high_threshold = 90.0
    await db.flush()
    await db.commit()
    return AuditPointResetResult(
        items=[AuditPointOut.model_validate(serialize_audit_point(p)) for p in rows]
    )


@router.post("/{code}/points/batch", response_model=AuditPointBatchResult)
async def create_points_batch(
    code: str,
    body: AuditPointBatchCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointBatchResult:
    await _ensure_package(db, code)
    item = await _ensure_item_writable(db, code, body.item_id)
    # 通用审核项下不允许批量新增审核点（与单条 POST 一致）
    if item.is_builtin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项下不允许批量新增审核点；请新建个性化审核项。",
        )

    items: list[AuditPointBatchItem] = []
    succeeded = 0
    for idx, raw in enumerate(body.points):
        forced = raw.model_copy(update={"item_id": body.item_id})
        try:
            payload = AuditPointCreate.model_validate(forced)
        except ValidationError as ve:
            msg = ve.errors()[0].get("msg", "校验失败") if ve.errors() else "校验失败"
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=raw.label_cn,
                    status="error",
                    error=msg,
                )
            )
            continue

        try:
            generated = await _generate_point_code(db, code, body.item_id)
            point = AuditPoint(
                package_code=code,
                item_id=body.item_id,
                code=generated,
                label=generated,
                label_cn=payload.label_cn,
                description=payload.description,
                medium_threshold=payload.medium_threshold,
                high_threshold=payload.high_threshold,
                scope_text=payload.scope_text,
                risk_level=payload.risk_level,
                is_enabled=payload.is_enabled,
                custom_wordset_id=payload.custom_wordset_id,
                sort_order=payload.sort_order,
            )
            db.add(point)
            await db.flush()
            if payload.linked_library_ids is not None:
                await _replace_linked_libraries(db, point, payload.linked_library_ids)
                await db.commit()
                db.expire(point, ["linked_library_links", "linked_libraries"])
                from sqlalchemy import select
                from sqlalchemy.orm import selectinload

                fresh = (
                    await db.execute(
                        select(AuditPoint)
                        .where(AuditPoint.id == point.id)
                        .options(
                            selectinload(AuditPoint.linked_library_links),
                            selectinload(AuditPoint.linked_libraries),
                        )
                    )
                ).scalar_one()
                serialized = serialize_audit_point(fresh)
            else:
                await db.refresh(point)
                await db.commit()
                serialized = serialize_audit_point(point)
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=payload.label_cn,
                    status="ok",
                    point=AuditPointOut.model_validate(serialized),
                )
            )
            succeeded += 1
        except IntegrityError:
            await db.rollback()
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=payload.label_cn,
                    status="error",
                    error="编码冲突，请重试",
                )
            )

    return AuditPointBatchResult(
        succeeded=succeeded,
        failed=len(body.points) - succeeded,
        items=items,
    )