"""Risk category API — 可由 superadmin / root_admin 运营维护的小模型风险类型字典。"""
from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.registered_model import RegisteredModel, RegisteredModelKind
from app.models.risk_category import RiskCategory
from app.models.user import User, UserRole
from app.schemas.risk_category import RiskCategoryCreate, RiskCategoryOut

router = APIRouter(prefix="/risk-categories", tags=["risk-categories"])

_COLOR_PALETTE = [
    "red",
    "orange",
    "gold",
    "green",
    "blue",
    "purple",
    "magenta",
    "volcano",
    "default",
]
_SLUG_RE = re.compile(r"[^a-z0-9_]+")


def _slugify(label: str) -> str:
    base = _SLUG_RE.sub("_", label.lower().strip()).strip("_")
    base = re.sub(r"_+", "_", base).strip("_")
    return base[:30] or "risk"


async def _allocate_code(db: AsyncSession, label: str) -> str:
    """根据 label 生成 code；冲突则追加 _2 / _3 ..."""
    base = _slugify(label)
    # 避免与历史 enum SmallModelCategory 重名
    if base in {"politics", "terrorism", "porn", "illicit", "ad",
                "religion", "ad_law", "abuse", "unhealthy"}:
        base = f"custom_{base}"

    candidate = base
    n = 2
    while True:
        exists = await db.execute(
            select(RiskCategory.id).where(RiskCategory.code == candidate)
        )
        if exists.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}_{n}"
        n += 1


async def _next_color_and_sort(db: AsyncSession) -> tuple[str, int]:
    """轮询色板 + 自增 sort_order。"""
    next_sort = await db.execute(select(func.coalesce(func.max(RiskCategory.sort_order), -1) + 1))
    sort_order = int(next_sort.scalar_one())
    color = _COLOR_PALETTE[sort_order % len(_COLOR_PALETTE)]
    return color, sort_order


def _require_superadmin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="新建风险类型仅 superadmin / root_admin 可操作",
        )
    return user


@router.get("", response_model=List[RiskCategoryOut])
async def list_risk_categories(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    is_builtin: Optional[bool] = Query(None, description="过滤系统预置项"),
):
    """列出全量风险类型字典，按 sort_order 升序。"""
    stmt = select(RiskCategory).order_by(RiskCategory.sort_order.asc(), RiskCategory.id.asc())
    if is_builtin is not None:
        stmt = stmt.where(RiskCategory.is_builtin == is_builtin)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post("", response_model=RiskCategoryOut, status_code=status.HTTP_201_CREATED)
async def create_risk_category(
    body: RiskCategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_require_superadmin),
):
    """新建风险类型。

    前端 Step 1 表单只传 label；code / color 后端自动分配。
    """
    label = body.label.strip()
    if not label:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="名称不能为空",
        )

    code = await _allocate_code(db, label)
    color, sort_order = await _next_color_and_sort(db)

    obj = RiskCategory(
        code=code,
        label=label,
        color=color,
        sort_order=sort_order,
        is_builtin=False,
        created_by_id=user.id,
    )
    db.add(obj)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="风险类型创建失败，请重试",
        )
    await db.refresh(obj)
    return obj


@router.patch("/{code}", response_model=RiskCategoryOut)
async def update_risk_category(
    code: str,
    body: RiskCategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_require_superadmin),
):
    """更新 label / color（code 与 is_builtin 由后端守护，code 字段本期前端不暴露编辑）。"""
    obj = (
        await db.execute(select(RiskCategory).where(RiskCategory.code == code))
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"风险类型 {code} 不存在",
        )
    if obj.is_builtin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="系统预置风险类型不允许编辑",
        )

    new_label = body.label.strip()
    if not new_label:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="名称不能为空",
        )
    obj.label = new_label
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk_category(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_require_superadmin),
):
    """删除风险类型。

    - 系统预置不允许删除。
    - 已被 RegisteredModel.small_category 引用的不允许删除。
    """
    obj = (
        await db.execute(select(RiskCategory).where(RiskCategory.code == code))
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"风险类型 {code} 不存在",
        )
    if obj.is_builtin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="系统预置风险类型不允许删除",
        )

    in_use = await db.execute(
        select(func.count(RegisteredModel.id))
        .where(
            RegisteredModel.kind == RegisteredModelKind.SMALL.value,
            RegisteredModel.small_category == code,
        )
    )
    if int(in_use.scalar_one() or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"风险类型 {code} 仍被小模型引用，请先解除引用",
        )

    await db.delete(obj)
    await db.commit()
    return None
