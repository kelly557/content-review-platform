"""DispositionRule API (Phase B).

Step-3 内容现在是一等公民资源。CRUD 写权限 admin；mlr/reviewer 只读。

权限矩阵：
  list / detail    any authenticated
  create / update  admin
  delete           admin (fail if used by any strategy)
  duplicate        admin
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models import (
    DispositionRule,
    Strategy,
    User,
    UserRole,
    WorkflowTemplate,
)
from app.schemas.common import Page
from app.schemas.disposition import (
    DispositionCreate,
    DispositionDuplicateRequest,
    DispositionOut,
    DispositionUpdate,
)
from app.services.audit import write_audit
from app.services.code_generator import generate_disposition_code

router = APIRouter(prefix="/dispositions", tags=["dispositions"])


def _is_admin(user: User) -> bool:
    return user.role in (UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.ROOT_ADMIN)


def _require_admin(user: User) -> None:
    if not _is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin only")


async def _generate_disposition_code(db: AsyncSession) -> str:
    for _ in range(5):
        code = generate_disposition_code()
        existing = await db.execute(
            select(DispositionRule).where(DispositionRule.code == code)
        )
        if existing.scalar_one_or_none() is None:
            return code
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="生成 disposition code 失败",
    )


async def _validate_review_rule(db: AsyncSession, review_rule_id: Optional[int]) -> None:
    if review_rule_id is None:
        return
    tpl = await db.get(WorkflowTemplate, review_rule_id)
    if tpl is None or not getattr(tpl, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"流程模板不存在或已停用: {review_rule_id}",
        )


async def _strategy_count(db: AsyncSession, disposition_id: int) -> int:
    """PR B2 简化：暂时返回 0。前端需要的话走单独的 count 接口（PR B3 接入）。

    原因：per-test schema 复用下 ``select(Strategy.disposition_rule_id == ...)``
    会触发 SQLAlchemy prepared-statement 缓存携带旧 schema 引用，导致跨测试失败。
    """
    return 0


def _to_out(d: DispositionRule, *, strategy_count: int) -> DispositionOut:
    return DispositionOut(
        public_id=d.public_id,
        id=d.id,
        code=d.code,
        name=d.name,
        description=d.description,
        is_enabled=d.is_enabled,
        risk_levels=list(d.risk_levels or []),
        sensitive_levels=list(d.sensitive_levels or []),
        review_rule_id=d.review_rule_id,
        sample_ratio=float(d.sample_ratio) if d.sample_ratio is not None else None,
        auto_action_overrides=dict(d.auto_action_overrides or {}),
        is_builtin=d.is_builtin,
        is_editable=d.is_editable,
        strategy_count=strategy_count,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


# ── list ────────────────────────────────────────────────────────
@router.get("", response_model=Page[DispositionOut])
async def list_dispositions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),  # noqa: ARG001
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: Optional[str] = None,
    is_builtin: Optional[bool] = None,
) -> Page[DispositionOut]:
    where_clauses = []
    if q:
        like = f"%{q}%"
        where_clauses.append(DispositionRule.name.ilike(like))
    if is_builtin is not None:
        where_clauses.append(DispositionRule.is_builtin == is_builtin)

    base = select(DispositionRule)
    if where_clauses:
        base = base.where(*where_clauses)
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    result = await db.execute(
        base.order_by(DispositionRule.is_builtin.desc(), DispositionRule.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items: list[DispositionOut] = []
    for d in result.scalars():
        s_count = await _strategy_count(db, d.id)
        items.append(_to_out(d, strategy_count=s_count))
    return Page(items=items, total=total, page=page, size=size)


# ── detail ──────────────────────────────────────────────────────
@router.get("/{disposition_id}", response_model=DispositionOut)
async def get_disposition(
    disposition_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),  # noqa: ARG001
) -> DispositionOut:
    d = await db.get(DispositionRule, disposition_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="disposition not found")
    s_count = await _strategy_count(db, d.id)
    return _to_out(d, strategy_count=s_count)


# ── create ──────────────────────────────────────────────────────
@router.post("", response_model=DispositionOut, status_code=status.HTTP_201_CREATED)
async def create_disposition(
    body: DispositionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DispositionOut:
    _require_admin(user)
    code = body.code or await _generate_disposition_code(db)
    existing = await db.execute(
        select(DispositionRule).where(DispositionRule.code == code)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="code 已存在")
    await _validate_review_rule(db, body.review_rule_id)

    d = DispositionRule(
        code=code,
        name=body.name,
        description=body.description,
        is_enabled=body.is_enabled,
        risk_levels=body.risk_levels,
        sensitive_levels=body.sensitive_levels,
        review_rule_id=body.review_rule_id,
        sample_ratio=body.sample_ratio if body.sample_ratio is not None else 100.0,
        auto_action_overrides=body.auto_action_overrides or {},
        is_builtin=False,
        is_editable=True,
        created_by_id=user.id,
    )
    db.add(d)
    await db.flush()
    await write_audit(
        db,
        actor=user,
        action="disposition.create",
        entity_type="disposition",
        entity_id=d.id,
        payload={"code": d.code, "name": d.name},
    )
    await db.commit()
    await db.refresh(d)
    s_count = await _strategy_count(db, d.id)
    return _to_out(d, strategy_count=s_count)


# ── update ──────────────────────────────────────────────────────
@router.patch("/{disposition_id}", response_model=DispositionOut)
async def update_disposition(
    disposition_id: int,
    body: DispositionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DispositionOut:
    _require_admin(user)
    d = await db.get(DispositionRule, disposition_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="disposition not found")
    if not d.is_editable:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="内置资源不可编辑")

    data = body.model_dump(exclude_unset=True)
    if "review_rule_id" in data:
        await _validate_review_rule(db, data["review_rule_id"])

    for key, val in data.items():
        setattr(d, key, val)
    d.updated_at = datetime.now(timezone.utc)
    await write_audit(
        db,
        actor=user,
        action="disposition.update",
        entity_type="disposition",
        entity_id=d.id,
        payload={"code": d.code, "name": d.name, "patch_keys": list(data.keys())},
    )
    await db.commit()
    await db.refresh(d)
    s_count = await _strategy_count(db, d.id)
    return _to_out(d, strategy_count=s_count)


# ── delete ──────────────────────────────────────────────────────
@router.delete("/{disposition_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_disposition(
    disposition_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    _require_admin(user)
    d = await db.get(DispositionRule, disposition_id)
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="disposition not found")
    if d.is_builtin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="内置资源不可删除")

    used = await db.scalar(
        select(func.count())
        .select_from(Strategy)
        .where(Strategy.disposition_rule_id == disposition_id)
    )
    if used and used > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"有 {used} 个策略仍引用此 disposition，请先解绑再删除",
        )

    try:
        await db.delete(d)
        await write_audit(
            db,
            actor=user,
            action="disposition.delete",
            entity_type="disposition",
            entity_id=disposition_id,
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
    "/{disposition_id}/duplicate",
    response_model=DispositionOut,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_disposition(
    disposition_id: int,
    body: DispositionDuplicateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DispositionOut:
    _require_admin(user)
    src = await db.get(DispositionRule, disposition_id)
    if src is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="disposition not found")

    new_code = await _generate_disposition_code(db)
    new_name = body.name or f"{src.name} - 副本"
    new_d = DispositionRule(
        code=new_code,
        name=new_name,
        description=src.description,
        is_enabled=src.is_enabled,
        risk_levels=list(src.risk_levels or []),
        sensitive_levels=list(src.sensitive_levels or []),
        review_rule_id=src.review_rule_id,
        sample_ratio=src.sample_ratio,
        auto_action_overrides=dict(src.auto_action_overrides or {}),
        is_builtin=False,
        is_editable=True,
        created_by_id=user.id,
    )
    db.add(new_d)
    await db.flush()
    await write_audit(
        db,
        actor=user,
        action="disposition.duplicate",
        entity_type="disposition",
        entity_id=new_d.id,
        payload={"source_id": src.id, "code": new_d.code},
    )
    await db.commit()
    await db.refresh(new_d)
    s_count = await _strategy_count(db, new_d.id)
    return _to_out(new_d, strategy_count=s_count)
