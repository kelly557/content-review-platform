"""Anomaly scanner — periodic background task.

Runs once per ``ALERT_SCAN_INTERVAL_SEC`` (default 300s). For each rule in
``ALERT_RULES`` it queries the DB for the most recent N-minute window and
the immediately preceding window of the same length. When the delta crosses
the rule threshold an ``AlertEvent`` row is inserted (deduped by
``(rule_code, window_start, window_end)``) and dispatched to notification
channels.

The scanner is started by ``app.main``'s ``lifespan`` and can be disabled
via ``ALERT_SCANNER_ENABLED=false``. When disabled, the loop returns
immediately and the function is safe to call repeatedly.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.alert_event import AlertEvent
from app.models.material import Material, MaterialStatus
from app.services import notifier

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Default rules — overridable via ``ALERT_RULES`` (JSON)
# ---------------------------------------------------------------------------


DEFAULT_RULES: Dict[str, Dict[str, Any]] = {
    # Reject-rate spike: most recent window vs previous window (both length = window_min)
    "reject_rate_spike": {
        "enabled": True,
        "window_min": 30,
        "threshold_pp": 3.0,           # observed - previous >= 3.0 percentage points
        "min_submitted": 20,           # ignore windows with < 20 submissions
        "severity": "warn",
    },
    # High-risk account cluster: >= N distinct submitters with a rejection in window
    "high_risk_concentration": {
        "enabled": True,
        "window_min": 60,
        "threshold_count": 5,
        "min_submitted": 10,
        "severity": "warn",
    },
    # Sudden submit drop: volume drop by 50% vs previous window
    "submit_drop": {
        "enabled": True,
        "window_min": 60,
        "threshold_pct": 50.0,
        "min_submitted": 50,
        "severity": "info",
    },
}


def _load_rules() -> Dict[str, Dict[str, Any]]:
    raw = getattr(settings, "alert_rules_json", "")
    if not raw:
        return {k: dict(v) for k, v in DEFAULT_RULES.items()}
    try:
        custom = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("ALERT_RULES is not valid JSON; falling back to defaults")
        return {k: dict(v) for k, v in DEFAULT_RULES.items()}
    merged: Dict[str, Dict[str, Any]] = {k: dict(v) for k, v in DEFAULT_RULES.items()}
    for k, v in custom.items():
        merged[k] = {**merged.get(k, {}), **v}
    return merged


# ---------------------------------------------------------------------------
# Window metric helpers
# ---------------------------------------------------------------------------


REJECTED_STATUSES = (MaterialStatus.REJECTED, MaterialStatus.WITHDRAWN)
SUBMITTED_STATUSES = (
    MaterialStatus.SUBMITTED,
    MaterialStatus.IN_REVIEW,
    MaterialStatus.APPROVED,
    MaterialStatus.REJECTED,
    MaterialStatus.WITHDRAWN,
    # DESENSITIZED intentionally omitted — see report_metrics.py
)


async def _window_stats(
    db: AsyncSession, start: datetime, end: datetime
) -> Dict[str, int]:
    sub = await db.scalar(
        select(Material.id)
        .where(Material.created_at >= start)
        .where(Material.created_at < end)
        .where(Material.status.in_(SUBMITTED_STATUSES))
        .limit(1)
    )
    submit_count = await db.scalar(
        select(Material.id)
        .where(Material.created_at >= start)
        .where(Material.created_at < end)
        .where(Material.status.in_(SUBMITTED_STATUSES))
        .with_only_columns(Material.id)
    )
    # Use COUNT for clarity
    from sqlalchemy import func

    sub = await db.scalar(
        select(func.count(Material.id))
        .where(Material.created_at >= start)
        .where(Material.created_at < end)
        .where(Material.status.in_(SUBMITTED_STATUSES))
    ) or 0
    rej = await db.scalar(
        select(func.count(Material.id))
        .where(Material.created_at >= start)
        .where(Material.created_at < end)
        .where(Material.status.in_(REJECTED_STATUSES))
    ) or 0
    distinct_rej_submitters = await db.scalar(
        select(func.count(func.distinct(Material.submitter_id)))
        .where(Material.created_at >= start)
        .where(Material.created_at < end)
        .where(Material.status.in_(REJECTED_STATUSES))
    ) or 0
    _ = sub_count = sub  # silence the unused warning while keeping readability
    return {
        "submitted": int(sub),
        "rejected": int(rej),
        "distinct_rejected_submitters": int(distinct_rej_submitters),
    }


# ---------------------------------------------------------------------------
# Core: scan once
# ---------------------------------------------------------------------------


async def scan_once(
    db: AsyncSession,
    *,
    now: Optional[datetime] = None,
    rules: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[AlertEvent]:
    now = now or datetime.now(timezone.utc)
    rules = rules or _load_rules()
    created: List[AlertEvent] = []

    for rule_code, rule in rules.items():
        if not rule.get("enabled", True):
            continue
        window_min = int(rule.get("window_min", 30))
        w_end = now
        w_start = now - timedelta(minutes=window_min)
        prev_start = w_start - timedelta(minutes=window_min)
        prev_end = w_start

        cur = await _window_stats(db, w_start, w_end)
        prev = await _window_stats(db, prev_start, prev_end)

        evt = await _evaluate_rule(
            db,
            rule_code=rule_code,
            rule=rule,
            cur=cur,
            prev=prev,
            cur_window=(w_start, w_end),
            prev_window=(prev_start, prev_end),
        )
        if evt is not None:
            created.append(evt)
    return created


async def _evaluate_rule(
    db: AsyncSession,
    *,
    rule_code: str,
    rule: Dict[str, Any],
    cur: Dict[str, int],
    prev: Dict[str, int],
    cur_window: tuple,
    prev_window: tuple,
) -> Optional[AlertEvent]:
    """Apply a single rule. Returns the inserted AlertEvent or None."""
    w_start, w_end = cur_window
    if rule_code == "reject_rate_spike":
        if cur["submitted"] < int(rule.get("min_submitted", 20)):
            return None
        cur_rate = (cur["rejected"] / cur["submitted"]) * 100 if cur["submitted"] else 0
        prev_rate = (prev["rejected"] / prev["submitted"]) * 100 if prev["submitted"] else 0
        delta = cur_rate - prev_rate
        if delta < float(rule.get("threshold_pp", 3.0)):
            return None
        return await _insert_alert(
            db,
            rule_code=rule_code,
            severity=rule.get("severity", "warn"),
            metric="reject_rate",
            w_start=w_start,
            w_end=w_end,
            observed=float(round(delta, 2)),
            threshold=float(rule.get("threshold_pp", 3.0)),
            detail={
                "current_reject_rate": round(cur_rate, 2),
                "previous_reject_rate": round(prev_rate, 2),
                "current_submitted": cur["submitted"],
                "previous_submitted": prev["submitted"],
            },
        )
    if rule_code == "high_risk_concentration":
        if cur["submitted"] < int(rule.get("min_submitted", 10)):
            return None
        distinct = cur["distinct_rejected_submitters"]
        if distinct < int(rule.get("threshold_count", 5)):
            return None
        return await _insert_alert(
            db,
            rule_code=rule_code,
            severity=rule.get("severity", "warn"),
            metric="distinct_rejected_submitters",
            w_start=w_start,
            w_end=w_end,
            observed=float(distinct),
            threshold=float(rule.get("threshold_count", 5)),
            detail={
                "current_submitted": cur["submitted"],
                "current_rejected": cur["rejected"],
            },
        )
    if rule_code == "submit_drop":
        if prev["submitted"] < int(rule.get("min_submitted", 50)):
            return None
        if prev["submitted"] == 0:
            return None
        drop_pct = (prev["submitted"] - cur["submitted"]) / prev["submitted"] * 100
        if drop_pct < float(rule.get("threshold_pct", 50.0)):
            return None
        return await _insert_alert(
            db,
            rule_code=rule_code,
            severity=rule.get("severity", "info"),
            metric="submitted",
            w_start=w_start,
            w_end=w_end,
            observed=float(round(cur["submitted"], 2)),
            threshold=float(prev["submitted"]),
            detail={
                "previous_submitted": prev["submitted"],
                "current_submitted": cur["submitted"],
                "drop_pct": round(drop_pct, 2),
            },
        )
    return None


async def _insert_alert(
    db: AsyncSession,
    *,
    rule_code: str,
    severity: str,
    metric: str,
    w_start: datetime,
    w_end: datetime,
    observed: float,
    threshold: float,
    detail: Dict[str, Any],
) -> Optional[AlertEvent]:
    """Insert an alert event; deduplicate on (rule_code, w_start, w_end)."""
    from sqlalchemy import func

    existing = await db.scalar(
        select(func.count(AlertEvent.id)).where(
            and_(
                AlertEvent.rule_code == rule_code,
                AlertEvent.window_start == w_start,
                AlertEvent.window_end == w_end,
            )
        )
    )
    if existing:
        return None
    alert = AlertEvent(
        rule_code=rule_code,
        severity=severity,
        metric=metric,
        window_start=w_start,
        window_end=w_end,
        observed_value=observed,
        threshold=threshold,
        detail=detail,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------


async def run_loop(stop_event: asyncio.Event) -> None:
    """Loop forever until ``stop_event`` is set."""
    if not getattr(settings, "alert_scanner_enabled", True):
        log.info("anomaly scanner disabled via ALERT_SCANNER_ENABLED")
        return
    interval = int(getattr(settings, "alert_scan_interval_sec", 300) or 300)
    log.info("anomaly scanner started (interval=%ss)", interval)
    # Build channels once
    channels = notifier.build_default_channels()
    log.info("notifier channels: %s", [getattr(c, "name", "?") for c in channels])

    while not stop_event.is_set():
        try:
            async with SessionLocal() as session:
                alerts = await scan_once(session)
            for alert in alerts:
                ok = await notifier.dispatch(alert, channels)
                if ok:
                    alert.notified = True
                    async with SessionLocal() as session:
                        session.add(alert)
                        await session.commit()
        except Exception:  # noqa: BLE001
            log.exception("anomaly scanner iteration failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
    log.info("anomaly scanner stopped")
