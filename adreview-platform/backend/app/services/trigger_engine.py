"""Trigger engine: cron loop + fire trigger + callback handler + cleanup.

The engine is the *executor*. It owns:

  - run_cron_loop(): periodic scan of due triggers
  - fire_trigger(): scan materials, route via services.routing, start workflows
  - handle_callback(): external webhook ingestion → write final decision
  - cleanup_old_runs(): 90-day retention sweep (called by library_cleanup loop)

Per product decision:
  - Per-material failures are skipped and counted (Q7).
  - The "actor" recorded on ReviewTask is the admin user (Q6).
  - strategy_id is resolved by services.routing before each start_instance().
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from croniter import croniter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.session import SessionLocal
from app.models.material import Material, MaterialStatus
from app.models.review import ReviewDecision, ReviewTask
from app.models.strategy import Strategy
from app.models.trigger import (
    Trigger,
    TriggerRun,
    TriggerRunSource,
    TriggerRunStatus,
    TriggerType,
)
from app.models.user import User, UserRole
from app.services import notifier
from app.services.audit import write_audit
from app.services.routing import resolve_strategy_for_trigger
from app.services.workflow_engine import start_instance

log = get_logger(__name__)


# ── System user for trigger-driven tasks ─────────────────────
# Loaded lazily on first use; cached per process.
_system_user_cache: Optional[User] = None


async def _get_system_user(db: AsyncSession) -> User:
    global _system_user_cache
    if _system_user_cache is not None:
        return _system_user_cache
    result = await db.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
    user = result.scalar_one_or_none()
    if user is None:
        # Fallback: any user. The DB should always have at least one admin
        # because the seed script creates one.
        result = await db.execute(select(User).limit(1))
        user = result.scalar_one_or_none()
    if user is None:
        raise RuntimeError("no user exists to act as trigger system actor")
    _system_user_cache = user
    return user


# ── Cron expression helpers ───────────────────────────────────
def compute_next_run(cron: str, tz_name: str = "Asia/Shanghai", base: Optional[datetime] = None) -> datetime:
    """Compute the next firing datetime for a cron expression.

    Uses naive UTC for croniter input then converts to the requested tz.
    """
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
    except Exception:  # pragma: no cover
        tz = timezone.utc

    base = base or datetime.now(timezone.utc)
    # croniter expects naive datetime in the *local* timezone of the user; pass utc-equivalent naive
    base_naive = base.astimezone(tz).replace(tzinfo=None)
    itr = croniter(cron, base_naive)
    next_naive = itr.get_next(datetime)
    return next_naive.replace(tzinfo=tz).astimezone(timezone.utc)


# ── Cron loop ─────────────────────────────────────────────────
async def run_cron_loop(stop_event: asyncio.Event) -> None:
    """Background task: every 60s, find due cron triggers and fire them."""
    while not stop_event.is_set():
        try:
            await _tick_cron_once()
        except Exception as exc:  # pragma: no cover
            log.error("trigger cron tick failed: %r", exc)
        # Sleep in 1s slices so shutdown is responsive.
        for _ in range(60):
            if stop_event.is_set():
                return
            await asyncio.sleep(1)


async def _tick_cron_once() -> None:
    """One pass of the cron sweep."""
    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Trigger).where(
                Trigger.is_enabled.is_(True),
                Trigger.trigger_type == TriggerType.CRON.value,
                Trigger.next_run_at.is_not(None),
                Trigger.next_run_at <= now,
            )
        )
        due_triggers = list(result.scalars())
        for trigger in due_triggers:
            try:
                await fire_trigger(trigger, source=TriggerRunSource.CRON.value)
            except Exception as exc:
                log.error("trigger %s fire failed: %r", trigger.code, exc)
                trigger.last_error = str(exc)[:1000]
            # Recompute next_run_at regardless of success.
            try:
                cron = (trigger.spec or {}).get("cron")
                tz_name = (trigger.spec or {}).get("timezone", "Asia/Shanghai")
                if cron:
                    trigger.next_run_at = compute_next_run(cron, tz_name, now)
            except Exception as exc:
                log.warning("trigger %s next_run_at compute failed: %r", trigger.code, exc)
        if due_triggers:
            await db.commit()


# ── Fire trigger ─────────────────────────────────────────────
async def fire_trigger(
    trigger: Trigger,
    source: Literal["cron", "manual", "system"] = "manual",
    batch_size: int = 100,
) -> TriggerRun:
    """Execute one trigger run.

    Resolves the workflow template (trigger.workflow_template_code or
    fallback 'auto_only'), iterates materials matching the trigger's
    *scope* (light filter: any material currently in DRAFT, REJECTED,
    SUBMITTED or IN_REVIEW), resolves a Strategy per material via the
    routing engine, and starts a workflow instance for each.
    """
    async with SessionLocal() as db:
        run = TriggerRun(trigger_id=trigger.id, source=source, status=TriggerRunStatus.RUNNING.value)
        db.add(run)
        await db.flush()

        details: Dict[str, Any] = {"task_ids": [], "skipped": [], "failed": []}

        try:
            template = await _load_template(db, trigger.workflow_template_code)
            if template is None:
                run.status = TriggerRunStatus.FAILED.value
                run.error = "workflow template not found"
                run.finished_at = datetime.now(timezone.utc)
                trigger.last_error = run.error
                trigger.last_run_at = run.finished_at
                trigger.run_count = (trigger.run_count or 0) + 1
                await db.commit()
                return run

            materials = await _query_materials(db, trigger, batch_size)
            run.scanned_count = len(materials)
            actor = await _get_system_user(db)

            for material in materials:
                try:
                    strategy = await resolve_strategy_for_trigger(db, trigger, material)
                    strategy_hr_raw = (
                        (strategy.definition or {}).get("human_review")
                        if strategy is not None
                        else None
                    )
                    # trigger 级 override + strategy 默认字段级合并
                    from app.schemas.strategy import HumanReviewSettings
                    from app.services.human_review_merge import (
                        merge_and_normalize_human_review,
                    )
                    trigger_override = None
                    if trigger.override_human_review:
                        trigger_override = HumanReviewSettings.model_validate(
                            trigger.override_human_review
                        )
                    strategy_human_review = merge_and_normalize_human_review(
                        strategy_hr_raw, trigger_override
                    )
                    instance = await start_instance(
                        db=db,
                        material=material,
                        template=template,
                        initiator=actor,
                        skip_machine_review=False,
                        strategy_human_review=strategy_human_review,
                        strategy=strategy,
                    )
                    details["task_ids"].append(
                        {"material_id": material.id, "workflow_instance_id": instance.id}
                    )
                    run.created_count += 1
                except Exception as exc:  # per-material failure
                    log.warning("trigger %s material %s failed: %r", trigger.code, material.id, exc)
                    run.failed_count += 1
                    details["failed"].append({"material_id": material.id, "error": str(exc)[:200]})

            run.details = details
            run.finished_at = datetime.now(timezone.utc)
            if run.failed_count == 0:
                run.status = TriggerRunStatus.SUCCESS.value
            elif run.created_count == 0:
                run.status = TriggerRunStatus.FAILED.value
            else:
                run.status = TriggerRunStatus.PARTIAL.value

            trigger.last_run_at = run.finished_at
            trigger.run_count = (trigger.run_count or 0) + 1
            trigger.last_error = None if run.status != TriggerRunStatus.FAILED.value else (run.error or "")
            await db.commit()
            return run

        except Exception as exc:
            log.error("trigger %s fire_trigger failed: %r", trigger.code, exc)
            run.status = TriggerRunStatus.FAILED.value
            run.error = str(exc)[:1000]
            run.finished_at = datetime.now(timezone.utc)
            trigger.last_error = run.error
            trigger.last_run_at = run.finished_at
            trigger.run_count = (trigger.run_count or 0) + 1
            run.details = details
            await db.commit()
            return run


async def _load_template(db: AsyncSession, code: Optional[str]):
    if not code:
        code = "auto_only"
    from app.services.workflow_engine import get_template_by_code

    return await get_template_by_code(db, code)


async def _query_materials(db: AsyncSession, trigger: Trigger, batch_size: int) -> List[Material]:
    """Lightweight scope: any material whose status is pre-review or in-review.

    Refines by spec.scope.material_type if present. Heavy filtering
    (date / tag / status exclusions) lives in spec.scope for future use.
    """
    spec = trigger.spec or {}
    scope = spec.get("scope", {}) if isinstance(spec, dict) else {}
    material_types = scope.get("material_type") if isinstance(scope, dict) else None

    q = select(Material).where(
        Material.status.in_(
            [
                MaterialStatus.DRAFT.value,
                MaterialStatus.SUBMITTED.value,
                MaterialStatus.IN_REVIEW.value,
                MaterialStatus.REJECTED.value,
            ]
        )
    )
    if material_types:
        q = q.where(Material.material_type.in_(material_types))
    q = q.order_by(Material.id.asc()).limit(batch_size)
    result = await db.execute(q)
    return list(result.scalars())


# ── External callback handler ─────────────────────────────────
async def handle_callback(trigger: Trigger, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Apply an external review result to the matching ReviewTask.

    Payload contract:
      {
        "task_id": int,
        "material_id": int,
        "decision": "approved|rejected|desensitize",
        "score": float (optional),
        "labels": [str] (optional),
        "reason": str (optional),
        "timestamp": str (optional),
        "external_id": str (optional)
      }
    """
    async with SessionLocal() as db:
        run = TriggerRun(
            trigger_id=trigger.id, source=TriggerRunSource.CALLBACK.value, status=TriggerRunStatus.RUNNING.value
        )
        db.add(run)
        await db.flush()

        try:
            task_id = payload.get("task_id")
            material_id = payload.get("material_id")
            decision_str = payload.get("decision")
            if not (task_id and material_id and decision_str):
                run.status = TriggerRunStatus.FAILED.value
                run.error = "missing task_id/material_id/decision"
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return {"received": False, "reason": run.error}

            task = await db.get(ReviewTask, task_id)
            if task is None:
                run.status = TriggerRunStatus.FAILED.value
                run.error = f"task {task_id} not found"
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return {"received": False, "reason": run.error}

            if task.material_id != material_id:
                run.status = TriggerRunStatus.FAILED.value
                run.error = "task/material mismatch"
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return {"received": False, "reason": run.error}

            decision = ReviewDecision(decision_str)
            task.final_decision = decision
            task.completed_at = datetime.now(timezone.utc)
            if payload.get("reason"):
                # ReviewComment.author_id is NOT NULL; the system has no user.
                # Stamp reason into the audit trail instead of a comment row.
                await write_audit(
                    db,
                    actor=None,
                    action="trigger.callback_reason",
                    entity_type="review_task",
                    entity_id=task.id,
                    payload={"reason": payload["reason"]},
                )

            run.created_count = 1
            run.details = {
                "task_id": task_id,
                "decision": decision_str,
                "external_id": payload.get("external_id"),
            }
            run.status = TriggerRunStatus.SUCCESS.value
            run.finished_at = datetime.now(timezone.utc)

            trigger.last_run_at = run.finished_at
            trigger.run_count = (trigger.run_count or 0) + 1

            await write_audit(
                db,
                actor=None,
                action="trigger.callback_received",
                entity_type="review_task",
                entity_id=task.id,
                payload={"trigger_code": trigger.code, "decision": decision_str},
            )
            await db.commit()
            return {
                "received": True,
                "task_id": task.id,
                "final_decision": task.final_decision.value,
            }
        except Exception as exc:
            log.error("handle_callback failed: %r", exc)
            run.status = TriggerRunStatus.FAILED.value
            run.error = str(exc)[:1000]
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
            return {"received": False, "reason": run.error}


# ── Cleanup ───────────────────────────────────────────────────
async def cleanup_old_runs(days: int = 90) -> int:
    """Delete trigger_runs older than N days. Returns affected row count."""
    async with SessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await db.execute(
            select(TriggerRun).where(TriggerRun.started_at < cutoff)
        )
        rows = list(result.scalars())
        for r in rows:
            await db.delete(r)
        await db.commit()
        return len(rows)


# ── Disable notify ───────────────────────────────────────────
async def notify_trigger_disabled(trigger: Trigger, actor: User) -> None:
    """Notify operators when a trigger is disabled (fail-safe against
    accidental misconfiguration)."""
    try:
        channels = notifier.build_default_channels()
        if not channels:
            return
        payload = {
            "type": "trigger_disabled",
            "trigger_id": trigger.id,
            "trigger_code": trigger.code,
            "trigger_name": trigger.name,
            "disabled_by": actor.email,
            "disabled_at": datetime.now(timezone.utc).isoformat(),
        }
        await notifier.dispatch(payload, channels)
    except Exception as exc:  # pragma: no cover
        log.warning("notify_trigger_disabled failed: %r", exc)