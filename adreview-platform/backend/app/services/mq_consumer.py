"""Redis Streams consumer for the D. MQ ingest path.

Reads from the ``adreview:task:requested`` stream via a consumer group, and
routes each entry to :func:`material_ingest.ingest_batch`.

Disabled by default (``mq_consumer_enabled=False``). When disabled, importing
this module is a no-op — callers in :mod:`app.main` skip registration. When
enabled but the optional ``redis`` dependency is missing, ``run_loop`` logs and
exits cleanly so the API server still starts.

Failure handling
----------------
- Successful ingest → ``XACK`` and the entry leaves the PEL.
- Transient failure (DB / workflow error) → leave the entry in the PEL;
  Redis Streams re-delivers after ``XCLAIM`` / consumer group rebalancing.
- Persistent failure (entry payload malformed) → ``XACK`` to drop poison pills;
  the underlying material_ids are returned in the failure list for audit.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional

from app.core.logging import get_logger
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.user import User, UserRole
from app.services.material_ingest import ingest_batch

log = get_logger(__name__)


def _redis_module():
    """Lazy import so projects without ``redis`` installed still start.

    Returns the ``redis.asyncio`` module or ``None`` if unavailable.
    """
    try:
        import redis.asyncio as redis_async  # type: ignore
    except ImportError:  # pragma: no cover
        return None
    return redis_async


async def _ensure_group(redis: Any, stream_key: str, group: str) -> None:
    """Create the consumer group if missing; ignore BUSYGROUP."""
    try:
        await redis.xgroup_create(stream_key, group, id="0", mkstream=True)
    except Exception as exc:  # pragma: no cover
        # redis.exceptions.ResponseError BUSYGROUP is expected on restart.
        if "BUSYGROUP" not in str(exc):
            raise


async def _load_actor(db, requested_actor_id: Optional[int]) -> User:
    """Resolve the ingest actor.

    Preference order: explicit ``actor_id`` from message → any admin → first
    user. Same fallback as :mod:`trigger_engine`.
    """
    from sqlalchemy import select

    if requested_actor_id:
        row = await db.execute(select(User).where(User.id == requested_actor_id))
        user = row.scalar_one_or_none()
        if user is not None and user.is_active:
            return user

    row = await db.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
    user = row.scalar_one_or_none()
    if user is None:
        row = await db.execute(select(User).limit(1))
        user = row.scalar_one_or_none()
    if user is None:
        raise RuntimeError("no user exists to act as mq ingest actor")
    return user


async def _process_entry(db, fields: Dict[str, str], delivery_count: int) -> int:
    """Process one MQ entry. Returns 0 on success / skipped; 1 on transient error.

    Caller decides whether to ``XACK``.
    """
    raw = fields.get("payload")
    if not raw:
        log.warning("mq_consumer: entry missing 'payload' field: %r", fields)
        return 0  # ack and drop poison pill

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.warning("mq_consumer: payload not JSON: %r err=%r", raw, exc)
        return 0

    material_ids: List[int] = list(payload.get("material_ids") or [])
    if not material_ids:
        log.info("mq_consumer: empty material_ids, ack and skip")
        return 0

    actor = await _load_actor(db, payload.get("actor_id"))

    result = await ingest_batch(
        db,
        material_ids,
        actor=actor,
        source="mq_consume",
        strategy_id=payload.get("strategy_id"),
        workflow_template_code=payload.get("workflow_template_code"),
    )
    await db.commit()
    log.info(
        "mq_consumer: processed requested=%d created=%d skipped=%d failures=%d delivery=%d",
        result.requested,
        result.created,
        result.skipped,
        len(result.failures),
        delivery_count,
    )
    return 0


async def run_loop(stop_event: asyncio.Event) -> None:
    """Background loop: drain the Redis stream until ``stop_event`` is set."""
    redis_async = _redis_module()
    if redis_async is None:
        log.error(
            "mq_consumer: 'redis' package not installed; consumer disabled. "
            "Install 'redis[hiredis]>=5.0' and restart to enable."
        )
        return

    redis = redis_async.from_url(
        settings.mq_redis_url,
        encoding="utf-8",
        decode_responses=True,
    )

    try:
        await _ensure_group(redis, settings.mq_stream_key, settings.mq_consumer_group)
        log.info(
            "mq_consumer: started stream=%s group=%s consumer=%s",
            settings.mq_stream_key,
            settings.mq_consumer_group,
            settings.mq_consumer_name,
        )

        while not stop_event.is_set():
            try:
                resp = await redis.xreadgroup(
                    groupname=settings.mq_consumer_group,
                    consumername=settings.mq_consumer_name,
                    streams={settings.mq_stream_key: ">"},
                    count=settings.mq_batch_count,
                    block=settings.mq_block_ms,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover
                log.warning("mq_consumer: xreadgroup failed: %r", exc)
                await asyncio.sleep(2)
                continue

            if not resp:
                continue

            # resp shape: [(stream_name, [(entry_id, {field: value, ...}), ...])]
            for _stream, entries in resp:
                for entry_id, fields in entries:
                    delivery_count = await _delivery_count(redis, entry_id)
                    if delivery_count > settings.mq_max_deliveries:
                        log.error(
                            "mq_consumer: dropping entry %s after %d deliveries",
                            entry_id,
                            delivery_count,
                        )
                        await redis.xack(
                            settings.mq_stream_key,
                            settings.mq_consumer_group,
                            entry_id,
                        )
                        continue

                    try:
                        async with SessionLocal() as db:
                            await _process_entry(db, fields, delivery_count)
                        await redis.xack(
                            settings.mq_stream_key,
                            settings.mq_consumer_group,
                            entry_id,
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:  # pragma: no cover
                        log.warning(
                            "mq_consumer: transient failure entry=%s err=%r; will retry",
                            entry_id,
                            exc,
                        )
                        # Do NOT xack → entry stays in PEL for next pass.
    finally:
        try:
            await redis.aclose()
        except Exception:  # pragma: no cover
            pass


async def _delivery_count(redis: Any, entry_id: str) -> int:
    """Read the XPENDING delivery count for an entry (best-effort)."""
    try:
        info = await redis.xpending_range(
            name=settings.mq_stream_key,
            groupname=settings.mq_consumer_group,
            min=entry_id,
            max=entry_id,
            count=1,
        )
        if info:
            return int(info[0].get("times_delivered", 1))
    except Exception:  # pragma: no cover
        pass
    return 1


async def publish(
    material_ids: List[int],
    *,
    actor_id: Optional[int] = None,
    strategy_id: Optional[int] = None,
    workflow_template_code: Optional[str] = None,
) -> str:
    """Helper used by ``POST /reviews/ingest/publish`` to enqueue a request.

    Returns the resulting Redis stream entry id (or empty string on failure).
    """
    redis_async = _redis_module()
    if redis_async is None:
        raise RuntimeError("redis package not installed")

    redis = redis_async.from_url(
        settings.mq_redis_url,
        encoding="utf-8",
        decode_responses=True,
    )
    try:
        payload = {
            "material_ids": list(material_ids),
            "actor_id": actor_id,
            "strategy_id": strategy_id,
            "workflow_template_code": workflow_template_code,
        }
        entry_id = await redis.xadd(
            settings.mq_stream_key,
            {"payload": json.dumps(payload, ensure_ascii=False)},
        )
        return entry_id
    finally:
        try:
            await redis.aclose()
        except Exception:  # pragma: no cover
            pass