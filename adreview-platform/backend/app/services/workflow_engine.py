"""Workflow engine: instantiating templates, advancing stages, evaluating join modes."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.material import Material, MaterialStatus
from app.models.review import MachineStatus, ReviewAssignment, ReviewDecision, ReviewTask, ReviewType
from app.models.user import User, UserRole
from app.models.workflow import WorkflowInstance, WorkflowNode, WorkflowTemplate
from app.services.audit import write_audit

log = get_logger(__name__)


class WorkflowError(Exception):
    pass


class TaskNotCancelableError(WorkflowError):
    """Raised when a task cannot be cancelled in its current state."""


def _role_for_stage(stage: dict) -> str:
    return stage.get("role", "reviewer")


def _type_for_stage(stage: dict) -> str:
    return stage.get("type", "human")


async def get_template_by_code(db: AsyncSession, code: str) -> Optional[WorkflowTemplate]:
    result = await db.execute(
        select(WorkflowTemplate).where(WorkflowTemplate.code == code, WorkflowTemplate.is_active.is_(True))
    )
    return result.scalar_one_or_none()


def _render_task_title(material_title: str, stage_name: str, review_type: str) -> str:
    """Render task title with basic variables."""
    type_label = "机审" if review_type == "machine" else "人审"
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    return f"{material_title} · {stage_name} · {type_label} · {timestamp}"


async def start_instance(
    db: AsyncSession,
    material: Material,
    template: WorkflowTemplate,
    initiator: User,
    force_human_rules: list[str] | None = None,
    task_name: str | None = None,
    skip_machine_review: bool = False,
    strategy_human_review: dict | None = None,
) -> WorkflowInstance:
    definition = template.definition or {}
    stages: list[dict] = definition.get("stages", [])
    if not stages:
        raise WorkflowError("template has no stages")

    instance = WorkflowInstance(
        material_id=material.id,
        material_version_id=material.current_version_id or 0,
        template_id=template.id,
        state="running",
        current_stage_key=stages[0]["key"],
        strategy_human_review=strategy_human_review,
    )
    db.add(instance)
    await db.flush()

    for idx, stage in enumerate(stages):
        node = WorkflowNode(
            instance_id=instance.id,
            position=idx,
            stage_key=stage["key"],
            name=stage.get("name", stage["key"]),
            required_role=_role_for_stage(stage),
            mode=stage.get("mode", "single"),
            node_type=_type_for_stage(stage),
            status="pending" if idx > 0 else "active",
        )
        db.add(node)

    first = stages[0]
    review_type = _type_for_stage(first)
    task_title = task_name if task_name else _render_task_title(material.title, first.get("name", first["key"]), review_type)

    task = ReviewTask(
        material_id=material.id,
        material_version_id=material.current_version_id or 0,
        workflow_instance_id=instance.id,
        stage_key=first["key"],
        title=task_title,
        review_type=ReviewType.MACHINE if review_type == "machine" else ReviewType.HUMAN,
        machine_status=MachineStatus.PENDING if review_type == "machine" else None,
    )
    db.add(task)
    await db.flush()

    material.status = MaterialStatus.IN_REVIEW
    await write_audit(
        db,
        actor=initiator,
        action="workflow.start",
        entity_type="workflow_instance",
        entity_id=instance.id,
        payload={"template": template.code, "material_id": material.id, "force_human_rules": force_human_rules or [], "skip_machine_review": skip_machine_review},
    )

    if review_type == "machine" and not skip_machine_review:
        from app.tasks.machine_review import run_machine_review
        import asyncio
        asyncio.create_task(_run_machine_review_async(task.id, force_human_rules))

    return instance


async def _run_machine_review_async(task_id: int, force_human_rules: list[str] | None = None) -> None:
    """Run machine review in background."""
    from app.db.session import SessionLocal
    from app.tasks.machine_review import run_machine_review

    async with SessionLocal() as db:
        await run_machine_review(task_id, db)


async def _activate_node(
    db: AsyncSession, instance: WorkflowInstance, node: WorkflowNode, material_id: int
) -> None:
    if node.status != "pending":
        return
    node.status = "active"
    instance.current_stage_key = node.stage_key

    material = await db.get(Material, material_id)
    material_title = material.title if material else "Unknown"

    task_title = _render_task_title(material_title, node.name, node.node_type)

    task = ReviewTask(
        material_id=material_id,
        material_version_id=instance.material_version_id,
        workflow_instance_id=instance.id,
        stage_key=node.stage_key,
        title=task_title,
        review_type=ReviewType.MACHINE if node.node_type == "machine" else ReviewType.HUMAN,
        machine_status=MachineStatus.PENDING if node.node_type == "machine" else None,
    )
    db.add(task)
    await db.flush()

    if node.node_type == "machine":
        from app.tasks.machine_review import run_machine_review
        import asyncio
        asyncio.create_task(_run_machine_review_async(task.id, None))


async def evaluate_stage_completion(db: AsyncSession, instance: WorkflowInstance) -> None:
    """Look at the current node; if all assignments resolved, advance or finalize."""
    instance = await _reload_instance(db, instance.id)
    if instance.state != "running":
        return

    current_node = next((n for n in instance.nodes if n.status == "active"), None)
    if current_node is None:
        return

    task = await _current_task_for_node(db, instance, current_node)
    if task is None:
        return

    if current_node.node_type == "machine":
        await _handle_machine_stage_completion(db, instance, current_node, task)
        return

    result = await db.execute(
        select(ReviewAssignment).where(ReviewAssignment.task_id == task.id)
    )
    assignments: list[ReviewAssignment] = list(result.scalars())

    decided = [a for a in assignments if a.decision != ReviewDecision.PENDING]
    pending = [a for a in assignments if a.decision == ReviewDecision.PENDING]

    rejected = [a for a in decided if a.decision == ReviewDecision.REJECTED]
    if rejected:
        await _finalize(db, instance, current_node, approved=False)
        return

    if pending:
        return

    approved = [a for a in decided if a.decision == ReviewDecision.APPROVED]
    if current_node.mode == "all":
        if not approved:
            await _finalize(db, instance, current_node, approved=False)
            return
    elif current_node.mode == "joint":
        if len(approved) < len(decided):
            await _finalize(db, instance, current_node, approved=False)
            return
    else:
        if not approved:
            await _finalize(db, instance, current_node, approved=False)
            return

    current_node.status = "approved"
    next_node = next((n for n in instance.nodes if n.status == "pending"), None)
    if next_node is None:
        await _finalize(db, instance, current_node, approved=True)
    else:
        await _activate_node(db, instance, next_node, instance.material_id)


async def _handle_machine_stage_completion(
    db: AsyncSession,
    instance: WorkflowInstance,
    current_node: WorkflowNode,
    task: ReviewTask,
) -> None:
    """Handle machine stage completion and decide whether to escalate to human.

    v9 改造：读 ``machine_result.suggested_action`` 落地到 3 类终态：

    - ``approved``        → 终态 APPROVED
    - ``rejected``        → 终态 REJECTED（含原中风险/OBSERVE 路径，v9 后统一拒绝）
    - ``desensitize``     → 终态 DESENSITIZED（S1 轻度敏感脱敏放行）
    - ``review``          → 升级到下一个人审节点（保持原行为）
    """
    if task.machine_status != MachineStatus.COMPLETED:
        return

    from app.tasks.machine_review import should_escalate_to_human

    should_escalate = await should_escalate_to_human(
        db,
        task,
        strategy_human_review=getattr(instance, "strategy_human_review", None),
    )

    current_node.status = "approved"

    if should_escalate:
        next_human_node = next(
            (n for n in instance.nodes if n.status == "pending" and n.node_type == "human"),
            None,
        )
        if next_human_node:
            await _activate_node(db, instance, next_human_node, instance.material_id)
            return

    # 不升级人审：按 suggested_action 落 3 类终态
    machine_result = task.machine_result or {}
    suggested = machine_result.get("suggested_action", "approved")

    if suggested == "rejected":
        await _finalize(db, instance, current_node, approved=False)
        return
    if suggested == "desensitize":
        await _finalize_desensitized(db, instance, current_node)
        return

    # approved / 兜底
    await _finalize(db, instance, current_node, approved=True)


async def _finalize_desensitized(
    db: AsyncSession,
    instance: WorkflowInstance,
    current_node: WorkflowNode,
) -> None:
    """脱敏：素材脱敏后放行（S1 轻度敏感）。"""
    instance.state = "approved"
    instance.completed_at = datetime.now(timezone.utc)
    for n in instance.nodes:
        if n.status == "pending":
            n.status = "skipped"

    material = await db.get(Material, instance.material_id)
    if material is not None:
        material.status = MaterialStatus.DESENSITIZED

    await write_audit(
        db,
        actor=None,
        action="workflow.desensitized",
        entity_type="workflow_instance",
        entity_id=instance.id,
        payload={"final_stage": current_node.stage_key},
    )


async def _reload_instance(db: AsyncSession, instance_id: int) -> WorkflowInstance:
    result = await db.execute(
        select(WorkflowInstance)
        .where(WorkflowInstance.id == instance_id)
        .options(selectinload(WorkflowInstance.nodes))
    )
    return result.scalar_one()


async def _finalize(
    db: AsyncSession,
    instance: WorkflowInstance,
    final_node: WorkflowNode,
    approved: bool,
) -> None:
    instance.state = "approved" if approved else "rejected"
    instance.completed_at = datetime.now(timezone.utc)
    if approved:
        for n in instance.nodes:
            if n.status == "pending":
                n.status = "skipped"

    material = await db.get(Material, instance.material_id)
    if material is not None:
        material.status = MaterialStatus.APPROVED if approved else MaterialStatus.REJECTED

    await write_audit(
        db,
        actor=None,
        action=f"workflow.{instance.state}",
        entity_type="workflow_instance",
        entity_id=instance.id,
        payload={"final_stage": final_node.stage_key},
    )


async def assign_reviewer(
    db: AsyncSession, instance: WorkflowInstance, node: WorkflowNode, user: User
) -> ReviewAssignment:
    """Append a reviewer to the current stage."""
    task = await _current_task_for_node(db, instance, node)
    if task is None:
        raise WorkflowError("no active task for current stage")

    exists_result = await db.execute(
        select(ReviewAssignment).where(
            ReviewAssignment.task_id == task.id, ReviewAssignment.assignee_id == user.id
        )
    )
    if exists_result.scalar_one_or_none():
        raise WorkflowError("user already assigned")

    if user.role.value not in (node.required_role, "admin"):
        if user.role.value == UserRole.ADMIN.value:
            pass
        else:
            raise WorkflowError(f"user role {user.role.value} cannot act on {node.required_role}")

    assignment = ReviewAssignment(task_id=task.id, assignee_id=user.id)
    db.add(assignment)
    return assignment


async def _current_task_for_node(
    db: AsyncSession, instance: WorkflowInstance, node: WorkflowNode
) -> Optional[ReviewTask]:
    result = await db.execute(
        select(ReviewTask)
        .where(
            ReviewTask.workflow_instance_id == instance.id,
            ReviewTask.stage_key == node.stage_key,
        )
        .order_by(ReviewTask.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def cancel_task(
    db: AsyncSession,
    task: ReviewTask,
    user: User,
    reason: Optional[str] = None,
) -> ReviewTask:
    """Operator-initiated cancellation.

    Allowed states:
      - ``final_decision == PENDING`` AND ``machine_status in (PENDING, RUNNING, None)``
      - i.e. the task is queued, running, or waiting for human review but
        not yet decided.

    Side effects:
      - Marks the task ``canceled`` with ``canceled_at`` / ``canceled_by`` /
        ``cancel_reason``.
      - Marks the parent ``WorkflowInstance.state = 'canceled'`` and skips
        any pending nodes.
      - Marks the linked ``Material.status = WITHDRAWN`` so it no longer
        shows as IN_REVIEW.

    Note: in-flight machine review workers will still write their result
    to ``machine_result`` (the asyncio.create_task cannot be revoked),
    but ``final_decision='canceled'`` short-circuits downstream effects
    in ``evaluate_stage_completion`` / ``_handle_machine_stage_completion``
    because the instance is no longer in ``state='running'``.
    """
    if task.final_decision != ReviewDecision.PENDING:
        raise TaskNotCancelableError(
            f"task already finalized with decision={task.final_decision.value}"
        )

    if task.machine_status not in (MachineStatus.PENDING, MachineStatus.RUNNING, None):
        raise TaskNotCancelableError(
            f"machine review already {task.machine_status.value}; cannot cancel"
        )

    now = datetime.now(timezone.utc)
    task.final_decision = ReviewDecision.CANCELED
    task.canceled_at = now
    task.canceled_by = user.id
    task.cancel_reason = (reason or "").strip()[:500] or None
    task.completed_at = now

    # Cascade to the workflow instance and remaining nodes.
    instance = await db.get(
        WorkflowInstance, task.workflow_instance_id, options=[selectinload(WorkflowInstance.nodes)]
    )
    if instance is not None and instance.state == "running":
        instance.state = "canceled"
        instance.completed_at = now
        for n in instance.nodes:
            if n.status == "pending":
                n.status = "skipped"
            elif n.status == "active":
                n.status = "canceled"

    # Release the material out of IN_REVIEW so it stops blocking other flows.
    material = await db.get(Material, task.material_id)
    if material is not None and material.status == MaterialStatus.IN_REVIEW:
        material.status = MaterialStatus.WITHDRAWN

    await write_audit(
        db,
        actor=user,
        action="workflow.cancel",
        entity_type="review_task",
        entity_id=task.id,
        payload={"reason": task.cancel_reason, "stage": task.stage_key},
    )
    return task


async def get_workflow_mode(
    db: AsyncSession, workflow_instance_id: int
) -> str:
    """Derive the high-level workflow topology from node types.

    Returns one of:

      - ``'machine_only'``         — only machine stages
      - ``'machine_then_human'``   — at least one machine and one human stage

    Used by the list/detail API to render a ``workflow_mode`` Tag without
    persisting a redundant field on ``ReviewTask``.
    """
    result = await db.execute(
        select(WorkflowNode.node_type).where(WorkflowNode.instance_id == workflow_instance_id)
    )
    types = {row[0] for row in result.all()}
    if "human" in types:
        return "machine_then_human"
    return "machine_only"


def is_task_canceled(task: ReviewTask) -> bool:
    """Lightweight predicate used by polling loops to drop machine results
    that arrive after the task has been cancelled.

    The worker still writes ``machine_result`` (the asyncio task can't be
    cancelled), but downstream code should treat canceled tasks as terminal.
    """
    return task.final_decision == ReviewDecision.CANCELED