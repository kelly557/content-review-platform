"""Review router: list tasks, decide, transfer, comment."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.material import Material, MaterialStatus, MaterialType
from app.models.review import ReviewAssignment, ReviewAssignmentTag, ReviewDecision, ReviewTask, ReviewType, MachineStatus
from app.models.tag import Tag
from app.models.user import User
from app.models.workflow import WorkflowInstance, WorkflowNode
from app.schemas.common import Page
from app.schemas.review import (
    AddReviewerRequest,
    BulkDecideRequest,
    ReviewCancelRequest,
    ReviewCommentOut,
    ReviewDecisionRequest,
    ReviewTaskOut,
    TransferRequest,
)
from app.services import audit
from app.services.workflow_engine import (
    assign_reviewer,
    evaluate_stage_completion,
    get_workflow_mode,
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
    q: Optional[str] = Query(None, description="Search by task title"),
    material_type: Optional[MaterialType] = Query(None, description="Filter by material type"),
    review_type: Optional[ReviewType] = Query(None, description="Filter by review type"),
    status_filter: Optional[ReviewDecision] = Query(None, alias="status", description="Filter by final decision status"),
    machine_status: Optional[MachineStatus] = Query(None, description="Filter by machine review status"),
    sort_by: Optional[str] = Query("created_at", pattern="^(created_at|completed_at|title)$", description="Sort field"),
    sort_order: Optional[str] = Query("desc", pattern="^(asc|desc)$", description="Sort order"),
    created_after: Optional[datetime] = Query(None, description="Filter tasks created after this datetime"),
    created_before: Optional[datetime] = Query(None, description="Filter tasks created before this datetime"),
) -> Page[ReviewTaskOut]:
    if scope == "assigned":
        base = (
            select(ReviewTask)
            .join(ReviewAssignment, ReviewAssignment.task_id == ReviewTask.id)
            .join(Material, Material.id == ReviewTask.material_id)
            .where(ReviewAssignment.assignee_id == user.id)
        )
    elif scope == "mine":
        base = (
            select(ReviewTask)
            .join(Material, Material.id == ReviewTask.material_id)
            .where(Material.submitter_id == user.id)
        )
    else:  # "all"
        base = (
            select(ReviewTask)
            .join(Material, Material.id == ReviewTask.material_id)
        )

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

    if q:
        base = base.where(ReviewTask.title.ilike(f"%{q}%"))

    if material_type:
        base = base.where(Material.material_type == material_type)

    if review_type:
        base = base.where(ReviewTask.review_type == review_type)

    if status_filter:
        base = base.where(ReviewTask.final_decision == status_filter)

    if machine_status:
        base = base.where(ReviewTask.machine_status == machine_status)

    if created_after:
        base = base.where(ReviewTask.created_at >= created_after)

    if created_before:
        base = base.where(ReviewTask.created_at <= created_before)

    sort_column = getattr(ReviewTask, sort_by, ReviewTask.created_at)
    if sort_order == "desc":
        base = base.order_by(sort_column.desc())
    else:
        base = base.order_by(sort_column.asc())

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    result = await db.execute(
        base.options(
            selectinload(ReviewTask.assignments).selectinload(ReviewAssignment.tag_links),
            selectinload(ReviewTask.comments),
        )
        .offset((page - 1) * size)
        .limit(size)
    )
    items = []
    for t in result.scalars():
        mat = await db.get(Material, t.material_id)
        task_out = ReviewTaskOut.model_validate(t)
        if mat:
            task_out.material_type = mat.material_type
            task_out.material_status = mat.status
        # v10: derive workflow_mode from the workflow topology. Cheap because
        # the node_type column is small and indexed on workflow_instance_id.
        task_out.workflow_mode = await get_workflow_mode(db, t.workflow_instance_id)
        items.append(task_out)
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
        .options(
            selectinload(ReviewTask.assignments).selectinload(ReviewAssignment.tag_links),
            selectinload(ReviewTask.comments),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")
    task_out = ReviewTaskOut.model_validate(task)
    task_out.workflow_mode = await get_workflow_mode(db, task.workflow_instance_id)
    return task_out


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
        .options(
            selectinload(ReviewTask.assignments).selectinload(ReviewAssignment.tag_links),
            selectinload(ReviewTask.comments),
        )
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

    # Tag annotations: validate that all tag_ids reference active, non-deleted tags,
    # then create snapshot rows bound to this assignment.
    if body.tag_ids:
        unique_ids = list(dict.fromkeys(body.tag_ids))
        if len(unique_ids) > 20:
            raise HTTPException(status_code=400, detail="单次最多标注 20 个标签")
        tag_rows = (
            await db.execute(
                select(Tag).where(Tag.id.in_(unique_ids), Tag.deleted_at.is_(None))
            )
        ).scalars().all()
        found_ids = {t.id for t in tag_rows}
        missing = [tid for tid in unique_ids if tid not in found_ids]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"以下标签不存在或已删除: {', '.join(missing)}",
            )
        for tag in tag_rows:
            snapshot = {
                "id": tag.id,
                "code": tag.code,
                "name": tag.name,
                "domain": tag.domain.value if hasattr(tag.domain, "value") else tag.domain,
                "category": tag.category.value if hasattr(tag.category, "value") else tag.category,
                "status": tag.status.value if hasattr(tag.status, "value") else tag.status,
            }
            assignment.tag_links.append(
                ReviewAssignmentTag(tag_id=tag.id, tag_snapshot=snapshot)
            )

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


@router.post("/tasks/{task_id}/cancel", response_model=ReviewTaskOut)
async def cancel_task(
    task_id: int,
    body: ReviewCancelRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReviewTaskOut:
    """Operator-initiated cancellation of a pending task (v10).

    Permissions: submitter (own materials) / admin / reviewer.
    """
    from app.services.workflow_engine import (
        TaskNotCancelableError,
        cancel_task as cancel_task_svc,
    )

    result = await db.execute(
        select(ReviewTask)
        .where(ReviewTask.id == task_id)
        .options(
            selectinload(ReviewTask.assignments).selectinload(ReviewAssignment.tag_links),
            selectinload(ReviewTask.comments),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")

    # Permission: admin can cancel any task; submitter only their own materials;
    # reviewers can cancel anything they have a pending assignment on.
    mat = await db.get(Material, task.material_id)
    is_owner_submitter = (
        user.role.value == "submitter" and mat is not None and mat.submitter_id == user.id
    )
    has_pending_assignment = any(
        a.assignee_id == user.id and a.decision == ReviewDecision.PENDING
        for a in task.assignments
    )
    if user.role.value != "admin" and not is_owner_submitter and not has_pending_assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not allowed to cancel this task",
        )

    try:
        await cancel_task_svc(db, task, user, body.reason)
    except TaskNotCancelableError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    await db.commit()

    # Reload + decorate for response
    refreshed = await db.execute(
        select(ReviewTask)
        .where(ReviewTask.id == task_id)
        .options(
            selectinload(ReviewTask.assignments).selectinload(ReviewAssignment.tag_links),
            selectinload(ReviewTask.comments),
        )
    )
    task = refreshed.scalar_one()
    task_out = ReviewTaskOut.model_validate(task)
    task_out.workflow_mode = await get_workflow_mode(db, task.workflow_instance_id)
    if mat:
        task_out.material_type = mat.material_type
        task_out.material_status = mat.status
    return task_out


@router.post("/tasks/bulk-decide")
async def bulk_decide(
    body: BulkDecideRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    success_count = 0
    failed_ids = []

    for task_id in body.task_ids:
        result = await db.execute(
            select(ReviewTask)
            .where(ReviewTask.id == task_id)
            .options(selectinload(ReviewTask.assignments), selectinload(ReviewTask.comments))
        )
        task = result.scalar_one_or_none()
        if not task:
            failed_ids.append(task_id)
            continue

        assignment = next(
            (a for a in task.assignments if a.assignee_id == user.id and a.decision == ReviewDecision.PENDING),
            None,
        )
        if assignment is None:
            failed_ids.append(task_id)
            continue

        from datetime import datetime, timezone

        assignment.decision = body.decision
        assignment.note = body.note
        assignment.decided_at = datetime.now(timezone.utc)

        instance = await db.get(WorkflowInstance, task.workflow_instance_id)
        if instance is not None:
            await evaluate_stage_completion(db, instance)

        await audit.write_audit(
            db, actor=user, action=f"review.{body.decision.value}",
            entity_type="review_task", entity_id=task.id,
            payload={"stage": task.stage_key, "bulk": True},
        )
        success_count += 1

    await db.commit()
    return {"success": success_count, "failed": len(failed_ids), "failed_ids": failed_ids}


@router.post("/tasks/{task_id}/trigger-machine-review")
async def trigger_machine_review(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    task = await db.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="task not found")

    if task.review_type != ReviewType.MACHINE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="task is not a machine review task")

    if task.machine_status != MachineStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"machine review already started or completed (status: {task.machine_status})"
        )

    from app.tasks.machine_review import run_machine_review
    import asyncio
    asyncio.create_task(_run_machine_review_async(task.id, None))

    await audit.write_audit(
        db, actor=user, action="review.trigger_machine_review",
        entity_type="review_task", entity_id=task.id,
        payload={"stage": task.stage_key},
    )

    return {"message": "machine review triggered", "task_id": task_id}


async def _run_machine_review_async(task_id: int, force_human_rules: list[str] | None = None) -> None:
    from app.db.session import SessionLocal
    from app.tasks.machine_review import run_machine_review

    async with SessionLocal() as db:
        await run_machine_review(task_id, db)
