"""Material ingest service — single funnel for any source of new review tasks.

Three entry points share this module:

  - **B. API push**         — `POST /api/v1/tasks/auto` (api/v1/tasks.py)
  - **D. MQ consume**       — Redis Streams worker (mq_consumer.py)
  - (legacy A)              — trigger_engine.cron still calls start_instance
                              directly, but new ingest paths use this module
                              so the per-material logic lives in one place.

Every ingest path ultimately calls :func:`ingest_for_review` which validates the
material, resolves a strategy + workflow template, and starts a workflow
instance. Failures are isolated per material so one bad row doesn't abort the
batch.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.material import Material, MaterialStatus
from app.models.strategy import Strategy
from app.models.workflow import WorkflowInstance, WorkflowTemplate
from app.models.user import User
from app.services.routing import resolve_strategy_for_trigger
from app.services.workflow_engine import start_instance, WorkflowError

IngestSource = Literal["api_push", "mq_consume"]

# Pre-review / in-review statuses eligible for auto-ingest.
# Mirrors trigger_engine._query_materials but is intentionally narrower than
# "any new material" — callers requesting re-review of approved/withdrawn
# materials must use the manual `/materials/{id}/submit` flow.
INGEST_ELIGIBLE_STATUSES = (
    MaterialStatus.DRAFT.value,
    MaterialStatus.SUBMITTED.value,
    MaterialStatus.IN_REVIEW.value,
    MaterialStatus.REJECTED.value,
)


@dataclass
class IngestFailure:
    material_id: int
    reason: str


@dataclass
class IngestResult:
    requested: int = 0
    created: int = 0
    skipped: int = 0
    workflow_instance_ids: List[int] = field(default_factory=list)
    failures: List[IngestFailure] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "requested": self.requested,
            "created": self.created,
            "skipped": self.skipped,
            "workflow_instance_ids": self.workflow_instance_ids,
            "errors": [{"material_id": f.material_id, "reason": f.reason} for f in self.failures],
        }


log = get_logger(__name__)


async def _load_template(db: AsyncSession, code: Optional[str]) -> Optional[WorkflowTemplate]:
    """Resolve a workflow template by code; fall back to any active one."""
    from sqlalchemy import select

    target = code or "auto_only"
    result = await db.execute(
        select(WorkflowTemplate).where(
            WorkflowTemplate.code == target,
            WorkflowTemplate.is_active.is_(True),
        )
    )
    template = result.scalar_one_or_none()
    if template is not None:
        return template
    # Last-resort fallback: pick any active template so callers don't get 500.
    fallback = await db.execute(
        select(WorkflowTemplate).where(WorkflowTemplate.is_active.is_(True)).limit(1)
    )
    return fallback.scalar_one_or_none()


async def _resolve_strategy(db: AsyncSession, material: Material) -> Optional[Strategy]:
    """Best-effort strategy resolution.

    A trigger object isn't available for API/MQ-driven ingests, so we synthesise
    a transient one that matches nothing in routing, which causes the routing
    helper to fall back to the default strategy (or None).
    """
    try:
        from app.models.trigger import Trigger  # local import to avoid cycle
        sentinel = Trigger(spec={}, match_conditions=None)
        return await resolve_strategy_for_trigger(db, sentinel, material)
    except Exception:  # pragma: no cover — routing engine is best-effort
        return None


async def ingest_one(
    db: AsyncSession,
    material: Material,
    *,
    actor: User,
    source: IngestSource,
    strategy_id: Optional[int] = None,
    workflow_template_code: Optional[str] = None,
) -> WorkflowInstance:
    """Start a workflow instance for a single material.

    Raises :class:`WorkflowError` if the material is in a non-eligible status
    or no workflow template can be resolved.
    """
    if material.status not in INGEST_ELIGIBLE_STATUSES:
        raise WorkflowError(
            f"material {material.id} status={material.status} not eligible for auto-ingest"
        )

    template = await _load_template(db, workflow_template_code)
    if template is None:
        raise WorkflowError("no active workflow template available")

    if strategy_id is not None:
        strategy = await db.get(Strategy, strategy_id)
    else:
        strategy = await _resolve_strategy(db, material)

    strategy_hr = None
    if strategy is not None:
        # Same legacy fallback as trigger_engine — let workflow_engine handle
        # disposition-based human_review composition.
        strategy_hr = (strategy.definition or {}).get("human_review")

    return await start_instance(
        db=db,
        material=material,
        template=template,
        initiator=actor,
        skip_machine_review=False,
        strategy_human_review=strategy_hr,
        strategy=strategy,
    )


async def ingest_batch(
    db: AsyncSession,
    material_ids: List[int],
    *,
    actor: User,
    source: IngestSource,
    strategy_id: Optional[int] = None,
    workflow_template_code: Optional[str] = None,
) -> IngestResult:
    """Run :func:`ingest_one` for every id; collect per-material outcomes.

    This function does NOT commit. The caller owns the transaction boundary so
    the same `db` can be reused for an outer audit write.
    """
    result = IngestResult(requested=len(material_ids))

    # Deduplicate while preserving caller order; preserves predictable reporting.
    seen: set[int] = set()
    ordered_ids: List[int] = []
    for mid in material_ids:
        if mid not in seen:
            seen.add(mid)
            ordered_ids.append(mid)

    for mid in ordered_ids:
        try:
            material = await db.get(Material, mid)
            if material is None:
                result.skipped += 1
                result.failures.append(IngestFailure(material_id=mid, reason="material not found"))
                continue
            try:
                instance = await ingest_one(
                    db,
                    material,
                    actor=actor,
                    source=source,
                    strategy_id=strategy_id,
                    workflow_template_code=workflow_template_code,
                )
                result.created += 1
                result.workflow_instance_ids.append(instance.id)
            except WorkflowError as exc:
                result.skipped += 1
                result.failures.append(IngestFailure(material_id=mid, reason=str(exc)))
                log.info("ingest skipped material=%s source=%s reason=%s", mid, source, exc)
        except Exception as exc:  # pragma: no cover — defensive
            result.skipped += 1
            result.failures.append(IngestFailure(material_id=mid, reason=repr(exc)[:200]))
            log.warning("ingest failed material=%s source=%s err=%r", mid, source, exc)

    return result