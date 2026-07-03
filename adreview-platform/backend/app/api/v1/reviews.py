"""Review router: list tasks, decide, transfer, comment."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.material import Material
from app.models.review import ReviewAssignment, ReviewDecision, ReviewTask
from app.models.user import User
from app.models.workflow import WorkflowInstance, WorkflowNode
from app.schemas.common import Page
from app.schemas.review import (
    AddReviewerRequest,
    ReviewCommentOut,
    ReviewDecisionRequest,
    ReviewTaskOut,
    TransferRequest,
)
from app.services import audit
from app.services.workflow_engine import (
    assign_reviewer,
    evaluate_stage_completion,
)

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("/tasks", response_model=Page[ReviewTaskOut])
async def list_my_tasks(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    pending: bool | None = Query(None, description="Filter by pending decision. None = no filter."),
    scope: str = Query(
        "assigned",
        pattern="^(assigned|mine|all)$",
        description="assigned: tasks assigned to me; mine: tasks from materials I submitted; all: every task",
    ),
) -> Page[ReviewTaskOut]:
    if scope == "assigned":
        base = (
            select(ReviewTask)
            .join(ReviewAssignment, ReviewAssignment.task_id == ReviewTask.id)
            .where(ReviewAssignment.assignee_id == user.id)
        )
    elif scope == "mine":
        base = select(ReviewTask).join(Material, Material.id == ReviewTask.material_id).where(
            Material.submitter_id == user.id
        )
    else:  # "all"
        base = select(ReviewTask)

    if pending is True:
        if scope == "assigned":
            base = base.where(ReviewAssignment.decision == ReviewDecision.PENDING)
        else:
            base = base.where(ReviewTask.final_decision == ReviewDecision.PENDING)
    elif pending is False:
        if scope == "assigned":
            base = base.where(ReviewAssignment.decision != ReviewDecision.PENDING)
        else:
            base = base.where(ReviewTask.final_decision != ReviewDecision.PENDING)

    base = base.order_by(ReviewTask.created_at.desc())

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    result = await db.execute(
        base.options(selectinload(ReviewTask.assignments), selectinload(ReviewTask.comments))
        .offset((page - 1) * size)
        .limit(size)
    )
    items = [ReviewTaskOut.model_validate(t) for t in result.scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.get("/tasks/{task_id}", response_model=ReviewTaskOut)
async def get_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ReviewTaskOut:
    result = await db.execute(
        select(ReviewTask)
        .where(ReviewTask.id == task_id)
        .options(selectinload(ReviewTask.assignments), selectinload(ReviewTask.comments))
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")
    return ReviewTaskOut.model_validate(task)


@router.post("/tasks/{task_id}/decide", response_model=ReviewTaskOut)
async def decide(
    task_id: int,
    body: ReviewDecisionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReviewTaskOut:
    result = await db.execute(
        select(ReviewTask)
        .where(ReviewTask.id == task_id)
        .options(selectinload(ReviewTask.assignments), selectinload(ReviewTask.comments))
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")

    assignment = next(
        (a for a in task.assignments if a.assignee_id == user.id and a.decision == ReviewDecision.PENDING),
        None,
    )
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your pending assignment")

    from datetime import datetime, timezone

    assignment.decision = body.decision
    assignment.note = body.note
    assignment.decided_at = datetime.now(timezone.utc)

    if body.comment_body:
        task.comments.append(
            __import__("app.models.annotation", fromlist=["ReviewComment"]).ReviewComment(
                author_id=user.id, body=body.comment_body
            )
        )

    instance = await db.get(WorkflowInstance, task.workflow_instance_id)
    if instance is not None:
        await evaluate_stage_completion(db, instance)
    await audit.write_audit(
        db, actor=user, action=f"review.{body.decision.value}",
        entity_type="review_task", entity_id=task.id,
        payload={"stage": task.stage_key},
    )
    await db.commit()
    return await get_task(task_id, db, user)


@router.post("/tasks/{task_id}/transfer", response_model=ReviewCommentOut)
async def transfer(
    task_id: int,
    body: TransferRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReviewCommentOut:
    result = await db.execute(
        select(ReviewTask)
        .where(ReviewTask.id == task_id)
        .options(selectinload(ReviewTask.assignments))
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")
    if not any(a.assignee_id == user.id and a.decision == ReviewDecision.PENDING for a in task.assignments):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your task")

    target = await db.get(User, body.to_user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target user not found")

    instance = await db.get(
        WorkflowInstance, task.workflow_instance_id, options=[selectinload(WorkflowInstance.nodes)]
    )
    if instance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workflow not found")
    node = next((n for n in instance.nodes if n.stage_key == task.stage_key and n.status == "active"), None)
    if node is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="stage not active")
    await assign_reviewer(db, instance, node, target)

    from app.models.annotation import ReviewComment

    comment = ReviewComment(author_id=user.id, task_id=task.id, body=f"转交给 {target.full_name}: {body.note or ''}")
    db.add(comment)
    await db.flush()
    await db.commit()
    return ReviewCommentOut.model_validate(comment)


@router.post("/tasks/{task_id}/add-reviewer", response_model=ReviewCommentOut)
async def add_reviewer(
    task_id: int,
    body: AddReviewerRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReviewCommentOut:
    result = await db.execute(
        select(ReviewTask).where(ReviewTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")

    target = await db.get(User, body.user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    instance = await db.get(
        WorkflowInstance, task.workflow_instance_id, options=[selectinload(WorkflowInstance.nodes)]
    )
    node = next((n for n in instance.nodes if n.stage_key == task.stage_key and n.status == "active"), None)
    if node is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="stage not active")
    await assign_reviewer(db, instance, node, target)

    from app.models.annotation import ReviewComment

    comment = ReviewComment(author_id=user.id, task_id=task.id, body=f"加签 {target.full_name}: {body.note or ''}")
    db.add(comment)
    await db.flush()
    await db.commit()
    return ReviewCommentOut.model_validate(comment)
