"""Workflow template + instance routes."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.human_review_config import HumanReviewConfig
from app.models.user import User
from app.models.workflow import WorkflowInstance, WorkflowTemplate
from app.schemas.review import (
    WorkflowInstanceOut,
    WorkflowTemplateCreate,
    WorkflowTemplateOut,
    WorkflowTemplateUpdate,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _to_out(t: WorkflowTemplate) -> WorkflowTemplateOut:
    return WorkflowTemplateOut.model_validate(t)


def _build_definition(stages: list[dict]) -> dict:
    """Inject auto-generated ``key`` and ``type`` per stage."""
    return {
        "stages": [
            {
                "key": f"stage_{i + 1}",
                "name": s.get("name", ""),
                "type": "human",
                "role": s.get("role", "reviewer"),
                "mode": s.get("mode", "single"),
            }
            for i, s in enumerate(stages)
        ]
    }


@router.get("/templates", response_model=List[WorkflowTemplateOut])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    prefix: Optional[str] = Query(
        None, description="按 code 前缀过滤（人审策略用 'hr_'）"
    ),
    include_inactive: bool = Query(False, description="是否包含已停用模板"),
) -> List[WorkflowTemplateOut]:
    stmt = select(WorkflowTemplate)
    conds = []
    if prefix:
        conds.append(WorkflowTemplate.code.like(f"{prefix}%"))
    if not include_inactive:
        conds.append(WorkflowTemplate.is_active.is_(True))
    if conds:
        stmt = stmt.where(*conds)
    stmt = stmt.order_by(WorkflowTemplate.id)
    result = await db.execute(stmt)
    return [_to_out(t) for t in result.scalars()]


@router.get("/templates/{template_id}", response_model=WorkflowTemplateOut)
async def get_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> WorkflowTemplateOut:
    t = await db.get(WorkflowTemplate, template_id)
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核规则不存在")
    return _to_out(t)


@router.post(
    "/templates",
    response_model=WorkflowTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    body: WorkflowTemplateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "mlr")),
) -> WorkflowTemplateOut:
    existing = (
        await db.execute(select(WorkflowTemplate).where(WorkflowTemplate.code == body.code))
    ).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail=f"编码已存在: {body.code}")
    tpl = WorkflowTemplate(
        code=body.code,
        name=body.name,
        description=body.description,
        definition=_build_definition([s.model_dump() for s in body.stages]),
        is_active=body.is_active,
    )
    db.add(tpl)
    await db.flush()
    await db.refresh(tpl)
    await db.commit()
    return _to_out(tpl)


@router.put("/templates/{template_id}", response_model=WorkflowTemplateOut)
async def update_template(
    template_id: int,
    body: WorkflowTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "mlr")),
) -> WorkflowTemplateOut:
    tpl = await db.get(WorkflowTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核规则不存在")
    if body.name is not None:
        tpl.name = body.name
    if body.description is not None:
        tpl.description = body.description
    if body.is_active is not None:
        tpl.is_active = body.is_active
    if body.stages is not None:
        tpl.definition = _build_definition([s.model_dump() for s in body.stages])
    await db.flush()
    await db.refresh(tpl)
    await db.commit()
    return _to_out(tpl)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "mlr")),
) -> Response:
    tpl = await db.get(WorkflowTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核规则不存在")
    referenced = (
        await db.execute(
            select(HumanReviewConfig).where(HumanReviewConfig.review_rule_id == template_id)
        )
    ).scalars().first()
    if referenced:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该规则被服务引用，不能删除",
        )
    await db.delete(tpl)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/instances/{instance_id}", response_model=WorkflowInstanceOut)
async def get_instance(
    instance_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> WorkflowInstanceOut:
    result = await db.execute(
        select(WorkflowInstance)
        .where(WorkflowInstance.id == instance_id)
        .options(selectinload(WorkflowInstance.nodes))
    )
    inst = result.scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="instance not found")
    return WorkflowInstanceOut.model_validate(inst)
