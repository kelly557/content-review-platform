"""Workflow template + instance routes."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.models.workflow import WorkflowInstance, WorkflowTemplate
from app.schemas.review import WorkflowInstanceOut, WorkflowTemplateOut

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("/templates", response_model=list[WorkflowTemplateOut])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[WorkflowTemplateOut]:
    result = await db.execute(
        select(WorkflowTemplate).where(WorkflowTemplate.is_active.is_(True)).order_by(WorkflowTemplate.id)
    )
    return [WorkflowTemplateOut.model_validate(t) for t in result.scalars()]


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
