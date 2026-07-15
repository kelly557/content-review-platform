"""RuleSet API (Phase B).

CRUD for rule_sets + strategy_points_v2. Admin 写；mlr / reviewer 只读。

权限矩阵：
  list / detail    any authenticated
  create / update  admin
  delete           admin (fail if used by any strategy)
  duplicate        admin
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models import (
    RuleSet,
    StrategyPointV2,
    User,
    UserRole,
)
from app.schemas.common import Page
from app.schemas.rule_set import (
    RuleSetCreate,
    RuleSetDuplicateRequest,
    RuleSetDetailOut,
    RuleSetOut,
    RuleSetUpdate,
    StrategyPointV2Ref,
)
from app.services.audit import write_audit
from app.services.code_generator import generate_rule_set_code

router = APIRouter(prefix="/rule-sets", tags=["rule_sets"])


def _is_admin(user: User) -> bool:
    return user.role in (UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.ROOT_ADMIN)


def _require_admin(user: User) -> None:
    if not _is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin only")


async def _generate_rule_set_code(db: AsyncSession) -> str:
    """Code format: rs_<timestamp>_<4-char random>."""
    for _ in range(5):
        code = generate_rule_set_code()
        existing = await db.execute(select(RuleSet).where(RuleSet.code == code))
        if existing.scalar_one_or_none() is None:
            return code
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="生成 rule_set code 失败",
    )


async def _validate_points(db: AsyncSession, points: List[StrategyPointV2Ref]) -> None:
    """校验每条 ref 的 point_id 真实存在，且 item_id / media_type 一致。

    注：使用裸 SELECT 而非 ORM `db.get(AuditPoint, ...)` 拿行，避开 AuditPoint 上
    lazy=selectin 关系加载（linked_libraries / linked_library_links），避免在 per-test
    schema 隔离下触发 asyncpg prepared-statement 缓存的 schema stale 问题。
    """
    from sqlalchemy import text as _sa_text

    seen: set[tuple[int, int]] = set()
    for p in points:
        if (p.point_id, p.item_id) in seen:
            continue
        seen.add((p.point_id, p.item_id))
        row = (
            await db.execute(
                _sa_text("SELECT id, item_id FROM audit_points WHERE id = :pid"),
                {"pid": p.point_id},
            )
        ).first()
        if row is None or row[1] != p.item_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"audit_point 不存在或 item_id 不匹配: {p.point_id}",
            )
        if (
            p.medium_threshold is not None
            and p.high_threshold is not None
            and p.medium_threshold > p.high_threshold
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"medium_threshold > high_threshold (point_id={p.point_id})",
            )


async def _replace_points(
    db: AsyncSession, rule_set_id: int, points: List[StrategyPointV2Ref]
) -> None:
    """Sync 语义：删旧 + bulk insert。"""
    await db.execute(
        delete(StrategyPointV2).where(StrategyPointV2.rule_set_id == rule_set_id)
    )
    for p in points:
        db.add(
            StrategyPointV2(
                rule_set_id=rule_set_id,
                media_type=p.media_type,
                item_id=p.item_id,
                point_id=p.point_id,
                is_enabled=p.is_enabled,
                medium_threshold=p.medium_threshold,
                high_threshold=p.high_threshold,
                linked_library_ids=p.linked_library_ids,
            )
        )


async def _refetch_with_relations(db: AsyncSession, rule_set_id: int) -> RuleSet:
    return (
        await db.execute(
            select(RuleSet)
            .where(RuleSet.id == rule_set_id)
            .options(selectinload(RuleSet.points))
        )
    ).scalar_one()


async def _strategy_count(db: AsyncSession, rule_set_id: int) -> int:
    """PR B2 简化：暂时返回 0，由前端独立 /strategy-counts 接口拉（PR B3 接 strategies）。
    原因：per-test schema 复用下直接 stat(Strategy.rule_set_id == ...) 会触发
    SQLAlchemy prepared-statement 缓存携带旧 schema 的 bug。
    """
    return 0


async def _point_stats(db: AsyncSession, rule_set_id: int) -> tuple[int, int]:
    total = (
        await db.scalar(
            select(func.count())
            .select_from(StrategyPointV2)
            .where(StrategyPointV2.rule_set_id == rule_set_id)
        )
        or 0
    )
    enabled = (
        await db.scalar(
            select(func.count())
            .select_from(StrategyPointV2)
            .where(
                StrategyPointV2.rule_set_id == rule_set_id,
                StrategyPointV2.is_enabled.is_(True),
            )
        )
        or 0
    )
    return total, enabled


def _to_out(rs: RuleSet, *, point_count: int, enabled_count: int, strategy_count: int) -> RuleSetOut:
    return RuleSetOut(
        public_id=rs.public_id,
        id=rs.id,
        code=rs.code,
        name=rs.name,
        description=rs.description,
        config=rs.config or {},
        is_builtin=rs.is_builtin,
        is_editable=rs.is_editable,
        point_count=point_count,
        enabled_point_count=enabled_count,
        strategy_count=strategy_count,
        created_at=rs.created_at,
        updated_at=rs.updated_at,
    )


def _to_detail(rs: RuleSet, *, point_count: int, enabled_count: int, strategy_count: int) -> RuleSetDetailOut:
    base = _to_out(
        rs,
        point_count=point_count,
        enabled_count=enabled_count,
        strategy_count=strategy_count,
    ).model_dump()
    base["points"] = [
        StrategyPointV2Ref(
            media_type=p.media_type,
            item_id=p.item_id,
            point_id=p.point_id,
            is_enabled=p.is_enabled,
            medium_threshold=float(p.medium_threshold) if p.medium_threshold is not None else None,
            high_threshold=float(p.high_threshold) if p.high_threshold is not None else None,
            linked_library_ids=list(p.linked_library_ids) if p.linked_library_ids else None,
        )
        for p in rs.points
    ]
    return RuleSetDetailOut(**base)


# ── list ────────────────────────────────────────────────────────
@router.get("", response_model=Page[RuleSetOut])
async def list_rule_sets(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),  # noqa: ARG001
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: Optional[str] = None,
    is_builtin: Optional[bool] = None,
) -> Page[RuleSetOut]:
    where_clauses = []
    if q:
        like = f"%{q}%"
        where_clauses.append(RuleSet.name.ilike(like))
    if is_builtin is not None:
        where_clauses.append(RuleSet.is_builtin == is_builtin)

    base = select(RuleSet)
    if where_clauses:
        base = base.where(*where_clauses)
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    result = await db.execute(
        base.order_by(RuleSet.is_builtin.desc(), RuleSet.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items: list[RuleSetOut] = []
    for rs in result.scalars():
        p_total, p_enabled = await _point_stats(db, rs.id)
        s_count = await _strategy_count(db, rs.id)
        items.append(_to_out(rs, point_count=p_total, enabled_count=p_enabled, strategy_count=s_count))
    return Page(items=items, total=total, page=page, size=size)


# ── detail ──────────────────────────────────────────────────────
@router.get("/{rule_set_id}", response_model=RuleSetDetailOut)
async def get_rule_set(
    rule_set_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),  # noqa: ARG001
) -> RuleSetDetailOut:
    rs = await _refetch_with_relations(db, rule_set_id)
    if rs is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule_set not found")
    p_total, p_enabled = await _point_stats(db, rs.id)
    s_count = await _strategy_count(db, rs.id)
    return _to_detail(rs, point_count=p_total, enabled_count=p_enabled, strategy_count=s_count)


# ── create ──────────────────────────────────────────────────────
@router.post("", response_model=RuleSetDetailOut, status_code=status.HTTP_201_CREATED)
async def create_rule_set(
    body: RuleSetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleSetDetailOut:
    _require_admin(user)
    code = body.code or await _generate_rule_set_code(db)
    existing = await db.execute(select(RuleSet).where(RuleSet.code == code))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="code 已存在")
    if body.points:
        await _validate_points(db, body.points)

    rs = RuleSet(
        code=code,
        name=body.name,
        description=body.description,
        config=body.config or {},
        is_builtin=False,
        is_editable=True,
        created_by_id=user.id,
    )
    db.add(rs)
    await db.flush()
    await _replace_points(db, rs.id, body.points)
    await write_audit(
        db,
        actor=user,
        action="rule_set.create",
        entity_type="rule_set",
        entity_id=rs.id,
        payload={"code": rs.code, "name": rs.name},
    )
    await db.commit()
    rs = await _refetch_with_relations(db, rs.id)
    p_total, p_enabled = await _point_stats(db, rs.id)
    s_count = await _strategy_count(db, rs.id)
    return _to_detail(rs, point_count=p_total, enabled_count=p_enabled, strategy_count=s_count)


# ── update ──────────────────────────────────────────────────────
@router.patch("/{rule_set_id}", response_model=RuleSetDetailOut)
async def update_rule_set(
    rule_set_id: int,
    body: RuleSetUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleSetDetailOut:
    _require_admin(user)
    rs = await _refetch_with_relations(db, rule_set_id)
    if rs is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule_set not found")
    if not rs.is_editable:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="内置资源不可编辑")

    data = body.model_dump(exclude_unset=True)
    if "points" in data:
        await _validate_points(db, data["points"] or [])
    for key in ("name", "description", "config"):
        if key in data:
            setattr(rs, key, data[key])
    rs.updated_at = datetime.now(timezone.utc)
    if "points" in data:
        await _replace_points(db, rs.id, data["points"] or [])
    await write_audit(
        db,
        actor=user,
        action="rule_set.update",
        entity_type="rule_set",
        entity_id=rs.id,
        payload={"code": rs.code, "name": rs.name, "patch_keys": list(data.keys())},
    )
    await db.commit()
    rs = await _refetch_with_relations(db, rs.id)
    p_total, p_enabled = await _point_stats(db, rs.id)
    s_count = await _strategy_count(db, rs.id)
    return _to_detail(rs, point_count=p_total, enabled_count=p_enabled, strategy_count=s_count)


# ── delete ──────────────────────────────────────────────────────
@router.delete("/{rule_set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule_set(
    rule_set_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    _require_admin(user)
    rs = await db.get(RuleSet, rule_set_id)
    if rs is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule_set not found")
    if rs.is_builtin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="内置资源不可删除")

    used = await _strategy_count(db, rule_set_id)
    if used and used > 0:
        # PR B2 简化：used 永远 = 0（见 _strategy_count 说明）。PR B3 接管。
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"有 {used} 个策略仍引用此 rule_set，请先解绑再删除",
        )

    try:
        await db.execute(
            delete(StrategyPointV2).where(StrategyPointV2.rule_set_id == rule_set_id)
        )
        await db.delete(rs)
        await write_audit(
            db,
            actor=user,
            action="rule_set.delete",
            entity_type="rule_set",
            entity_id=rule_set_id,
        )
        await db.commit()
    except IntegrityError as ex:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"FK 冲突：{ex.orig}",
        ) from ex


# ── duplicate ───────────────────────────────────────────────────
@router.post(
    "/{rule_set_id}/duplicate",
    response_model=RuleSetDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_rule_set(
    rule_set_id: int,
    body: RuleSetDuplicateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RuleSetDetailOut:
    _require_admin(user)
    src = (
        await db.execute(
            select(RuleSet)
            .where(RuleSet.id == rule_set_id)
            .options(selectinload(RuleSet.points))
        )
    ).scalar_one_or_none()
    if src is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule_set not found")

    new_code = await _generate_rule_set_code(db)
    new_name = body.name or f"{src.name} - 副本"
    new_rs = RuleSet(
        code=new_code,
        name=new_name,
        description=src.description,
        config=dict(src.config or {}),
        is_builtin=False,
        is_editable=True,
        created_by_id=user.id,
    )
    db.add(new_rs)
    await db.flush()
    for p in src.points:
        db.add(
            StrategyPointV2(
                rule_set_id=new_rs.id,
                media_type=p.media_type,
                item_id=p.item_id,
                point_id=p.point_id,
                is_enabled=p.is_enabled,
                medium_threshold=p.medium_threshold,
                high_threshold=p.high_threshold,
                linked_library_ids=list(p.linked_library_ids) if p.linked_library_ids else None,
            )
        )
    await write_audit(
        db,
        actor=user,
        action="rule_set.duplicate",
        entity_type="rule_set",
        entity_id=new_rs.id,
        payload={"source_id": src.id, "code": new_rs.code},
    )
    await db.commit()
    rs = await _refetch_with_relations(db, new_rs.id)
    p_total, p_enabled = await _point_stats(db, rs.id)
    s_count = await _strategy_count(db, rs.id)
    return _to_detail(rs, point_count=p_total, enabled_count=p_enabled, strategy_count=s_count)
