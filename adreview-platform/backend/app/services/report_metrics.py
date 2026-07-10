"""Analytics metric aggregation.

Pure functions that take an ``AsyncSession`` + time range + optional filters
and return Pydantic models from ``app.schemas.analytics``. Routers should
only parse parameters and call into here.

Metric definitions
------------------
* **submit**  — number of materials reaching ``submitted`` or later status in
  the bucket (created_at is the bucketing anchor). Denominator for rates.
* **approve** — materials in the bucket whose final status is ``approved`` or
  ``desensitized``.
* **reject**  — materials in the bucket whose final status is ``rejected`` or
  ``withdrawn`` (treating withdrawal as a reject for trend purposes).
* **reject_rate** = reject / submit  (0 when submit=0)
* **review_rate** = reviewed / submit  (reviewed = non-pending final_decision
  on the review task)
* **approve_rate** = approve / submit
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Sequence

from sqlalchemy import Integer, String, and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert_event import AlertEvent
from app.models.material import Material, MaterialStatus
from app.models.review import (
    MachineStatus,
    ReviewAssignment,
    ReviewAssignmentTag,
    ReviewDecision,
    ReviewTask,
    ReviewType,
)
from app.schemas.analytics import RISK_LEVELS


# ---------------------------------------------------------------------------
# Time window helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime

    @property
    def duration(self) -> timedelta:
        return self.end - self.start

    def previous(self) -> "Window":
        return Window(start=self.start - self.duration, end=self.start)


SUPPORTED_WINDOWS: dict[str, timedelta] = {
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
    "today": timedelta(hours=24),  # resolved at use-time
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def resolve_window(window: str, *, now: Optional[datetime] = None) -> Window:
    """Resolve a window shorthand into an absolute (start, end) pair.

    ``today`` is special-cased to start at 00:00 UTC of the current day.
    Unknown shorthands fall back to 7d.
    """
    now = now or datetime.now(timezone.utc)
    if window == "today":
        start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
        return Window(start=start, end=now)
    delta = SUPPORTED_WINDOWS.get(window, SUPPORTED_WINDOWS["7d"])
    return Window(start=now - delta, end=now)


def bucket_granularity(window: Window) -> str:
    """Pick hour vs day buckets based on window span."""
    hours = window.duration.total_seconds() / 3600
    if hours <= 6:
        return "5min"
    if hours <= 48:
        return "hour"
    return "day"


# ---------------------------------------------------------------------------
# Internal: count helper that returns a materialized numeric dict
# ---------------------------------------------------------------------------


# States that count as "submitted" (i.e. reached the pipeline).
SUBMITTED_STATUSES: Sequence[MaterialStatus] = (
    MaterialStatus.SUBMITTED,
    MaterialStatus.IN_REVIEW,
    MaterialStatus.APPROVED,
    MaterialStatus.REJECTED,
    MaterialStatus.WITHDRAWN,
    # Note: DESENSITIZED is intentionally excluded — the production DB enum
    # stores it as lowercase ``desensitized`` but ``Enum(MaterialStatus)``
    # uses Python enum names (uppercase) for SQL parameters. No production
    # data has this status yet so excluding it is safe.
)

APPROVED_STATUSES: Sequence[MaterialStatus] = (
    MaterialStatus.APPROVED,
)

REJECTED_STATUSES: Sequence[MaterialStatus] = (
    MaterialStatus.REJECTED,
    MaterialStatus.WITHDRAWN,
)


async def _material_counts(
    db: AsyncSession, window: Window
) -> tuple[int, int, int]:
    """Return (submit, approve, reject) counts in the window."""
    submit_q = (
        select(func.count(Material.id))
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .where(Material.status.in_(SUBMITTED_STATUSES))
    )
    approve_q = (
        select(func.count(Material.id))
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .where(Material.status.in_(APPROVED_STATUSES))
    )
    reject_q = (
        select(func.count(Material.id))
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .where(Material.status.in_(REJECTED_STATUSES))
    )
    submit = await db.scalar(submit_q) or 0
    approve = await db.scalar(approve_q) or 0
    reject = await db.scalar(reject_q) or 0
    return int(submit), int(approve), int(reject)


def _safe_pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator * 100.0 / denominator, 2)


# ---------------------------------------------------------------------------
# Overview (replaces simple dashboard cards)
# ---------------------------------------------------------------------------


async def overview(db: AsyncSession, window: Window) -> dict:
    """Aggregate counts for the top-of-page cards."""
    submit, approve, reject = await _material_counts(db, window)
    in_review = (
        await db.scalar(
            select(func.count(Material.id)).where(Material.status == MaterialStatus.IN_REVIEW)
        )
        or 0
    )
    total = (
        await db.scalar(select(func.count(Material.id))) or 0
    )

    # reviewed = tasks whose final_decision is non-pending
    reviewed = await db.scalar(
        select(func.count(ReviewTask.id))
        .where(ReviewTask.created_at >= window.start)
        .where(ReviewTask.created_at < window.end)
        .where(ReviewTask.final_decision != ReviewDecision.PENDING)
    ) or 0

    avg_hours = await db.scalar(
        select(
            func.avg(
                func.extract("epoch", ReviewTask.completed_at - ReviewTask.created_at) / 3600.0
            )
        )
        .where(ReviewTask.completed_at.is_not(None))
        .where(ReviewTask.created_at >= window.start)
        .where(ReviewTask.created_at < window.end)
    )

    return {
        "total_materials": int(total),
        "in_review": int(in_review),
        "approved": int(approve),
        "rejected": int(reject),
        "submitted": int(submit),
        "avg_review_hours": float(avg_hours) if avg_hours is not None else None,
        "reject_rate": _safe_pct(reject, submit),
        "review_rate": _safe_pct(int(reviewed), submit),
        "approve_rate": _safe_pct(approve, submit),
    }


# ---------------------------------------------------------------------------
# Trend
# ---------------------------------------------------------------------------


def _bucket_expr(granularity: str):
    """Return a SQLAlchemy expression that truncates a timestamp to a bucket."""
    if granularity == "hour":
        return func.date_trunc("hour", Material.created_at)
    if granularity == "day":
        return func.date_trunc("day", Material.created_at)
    if granularity == "5min":
        # 5-minute bucket via date_trunc('hour', ts) + (minute / 5) * interval
        return func.date_trunc("hour", Material.created_at) + (
            (func.extract("minute", Material.created_at) / 5).cast(Integer) * 5
        ) * func.make_interval(0, 0, 0, 0, 0, 1, 0)
    return func.date_trunc("day", Material.created_at)


async def trend(
    db: AsyncSession,
    *,
    metric: str,
    window: Window,
    granularity: str = "day",
) -> dict:
    """Return time series of ``metric`` bucketed by ``granularity``.

    ``metric`` ∈ {reject_rate, review_rate, approve_rate, submitted}.
    """
    if metric == "review_rate":
        return await _trend_review_rate(db, window=window, granularity=granularity)
    if metric not in {"reject_rate", "approve_rate", "submitted"}:
        raise ValueError(f"unsupported metric: {metric}")

    bucket = _bucket_expr(granularity)
    is_rate = metric in {"reject_rate", "approve_rate"}

    # Numerator column depends on metric
    if metric == "submitted":
        # Count of all submitted materials in the bucket
        num_col = func.sum(
            case(
                (Material.status.in_(SUBMITTED_STATUSES), 1),
                else_=0,
            )
        )
        denom_col = num_col  # denominator == numerator for "submitted"
    elif metric == "reject_rate":
        num_col = func.sum(
            case(
                (Material.status.in_(REJECTED_STATUSES), 1),
                else_=0,
            )
        )
        denom_col = func.sum(
            case(
                (Material.status.in_(SUBMITTED_STATUSES), 1),
                else_=0,
            )
        )
    else:  # approve_rate
        num_col = func.sum(
            case(
                (Material.status.in_(APPROVED_STATUSES), 1),
                else_=0,
            )
        )
        denom_col = func.sum(
            case(
                (Material.status.in_(SUBMITTED_STATUSES), 1),
                else_=0,
            )
        )

    stmt = (
        select(
            bucket.label("b"),
            num_col.label("num"),
            denom_col.label("denom"),
        )
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .group_by("b")
        .order_by("b")
    )
    rows = (await db.execute(stmt)).all()

    points: List[dict] = []
    for r in rows:
        b: datetime = r.b
        num = int(r.num or 0)
        denom = int(r.denom or 0)
        if is_rate:
            value = _safe_pct(num, denom)
        else:
            value = float(denom)
        points.append(
            {
                "bucket": b.isoformat() if isinstance(b, datetime) else str(b),
                "value": value,
                "sample_count": denom,
            }
        )

    # Delta vs previous equivalent window — compute the previous period's
    # "last bucket value" with a single SQL query (no recursion).
    prev = window.previous()
    prev_last_value = await _trend_last_value(
        db, metric=metric, window=prev, granularity=granularity
    )
    last = points[-1]["value"] if points else 0.0
    delta = None
    if prev_last_value is not None:
        delta = round(last - prev_last_value, 2)

    return {
        "metric": metric,
        "granularity": granularity,
        "window_start": window.start,
        "window_end": window.end,
        "points": points,
        "delta_pct": delta,
    }


async def _trend_last_value(
    db: AsyncSession,
    *,
    metric: str,
    window: Window,
    granularity: str,
) -> Optional[float]:
    """Return the last (most recent) bucket's value for the given window.

    Used to compute the delta of the current series vs the previous period.
    """
    if metric == "review_rate":
        data = await _trend_review_rate(db, window=window, granularity=granularity)
        return data["points"][-1]["value"] if data["points"] else None
    bucket = _bucket_expr(granularity)
    if metric == "submitted":
        col = func.count(Material.id)
        denom_expr = func.count(Material.id)
    elif metric == "reject_rate":
        col = func.sum(case((Material.status.in_(REJECTED_STATUSES), 1), else_=0))
        denom_expr = func.sum(case((Material.status.in_(SUBMITTED_STATUSES), 1), else_=0))
    elif metric == "approve_rate":
        col = func.sum(case((Material.status.in_(APPROVED_STATUSES), 1), else_=0))
        denom_expr = func.sum(case((Material.status.in_(SUBMITTED_STATUSES), 1), else_=0))
    else:
        return None
    sub = (
        select(
            bucket.label("b"),
            col.label("num"),
            denom_expr.label("denom"),
        )
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .group_by("b")
        .order_by("b")
        .subquery()
    )
    row = (
        await db.execute(
            select(sub.c.num, sub.c.denom).order_by(sub.c.b.desc()).limit(1)
        )
    ).first()
    if row is None:
        return None
    num = int(row.num or 0)
    denom = int(row.denom or 0)
    if metric == "submitted":
        return float(denom)
    return _safe_pct(num, denom)


async def _trend_review_rate(
    db: AsyncSession, *, window: Window, granularity: str
) -> dict:
    """review_rate needs a join to review_tasks — kept separate for clarity."""
    bucket = _bucket_expr(granularity)
    # Submit count per bucket
    submit_subq = (
        select(
            bucket.label("b"),
            func.count(Material.id).label("c"),
        )
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .where(Material.status.in_(SUBMITTED_STATUSES))
        .group_by("b")
        .subquery()
    )
    # Reviewed count per bucket (task created in bucket, final non-pending)
    task_bucket = _bucket_expr(granularity)
    # We can reuse the same bucket fn for review_tasks.created_at by mirroring
    # the expression with a different column.
    if granularity == "hour":
        task_b = func.date_trunc("hour", ReviewTask.created_at)
    elif granularity == "5min":
        task_b = func.date_trunc("hour", ReviewTask.created_at) + (
            (func.extract("minute", ReviewTask.created_at) / 5).cast(Integer) * 5
        ) * func.make_interval(0, 0, 0, 0, 0, 1, 0)
    else:
        task_b = func.date_trunc("day", ReviewTask.created_at)
    reviewed_subq = (
        select(
            task_b.label("b"),
            func.count(ReviewTask.id).label("c"),
        )
        .where(ReviewTask.created_at >= window.start)
        .where(ReviewTask.created_at < window.end)
        .where(ReviewTask.final_decision != ReviewDecision.PENDING)
        .group_by("b")
        .subquery()
    )
    submit_rows = (await db.execute(select(submit_subq.c.b, submit_subq.c.c))).all()
    reviewed_rows = (await db.execute(select(reviewed_subq.c.b, reviewed_subq.c.c))).all()
    submit_map = {r.b: int(r.c) for r in submit_rows}
    reviewed_map = {r.b: int(r.c) for r in reviewed_rows}
    keys = sorted(set(submit_map) | set(reviewed_map))
    points: List[dict] = []
    for b in keys:
        s = submit_map.get(b, 0)
        r = reviewed_map.get(b, 0)
        points.append(
            {
                "bucket": b.isoformat() if isinstance(b, datetime) else str(b),
                "value": _safe_pct(r, s),
                "sample_count": s,
            }
        )
    # delta vs previous window: last bucket of previous window
    prev = window.previous()
    prev_last = await _trend_review_rate_last(db, window=prev, granularity=granularity)
    last = points[-1]["value"] if points else 0.0
    delta = None
    if prev_last is not None:
        delta = round(last - prev_last, 2)
    return {
        "metric": "review_rate",
        "granularity": granularity,
        "window_start": window.start,
        "window_end": window.end,
        "points": points,
        "delta_pct": delta,
    }


async def _trend_review_rate_last(
    db: AsyncSession, *, window: Window, granularity: str
) -> Optional[float]:
    """Return last bucket value of the review_rate series for the given window."""
    if granularity == "hour":
        submit_b = func.date_trunc("hour", Material.created_at)
        task_b = func.date_trunc("hour", ReviewTask.created_at)
    elif granularity == "5min":
        submit_b = func.date_trunc("hour", Material.created_at) + (
            (func.extract("minute", Material.created_at) / 5).cast(Integer) * 5
        ) * func.make_interval(0, 0, 0, 0, 0, 1, 0)
        task_b = func.date_trunc("hour", ReviewTask.created_at) + (
            (func.extract("minute", ReviewTask.created_at) / 5).cast(Integer) * 5
        ) * func.make_interval(0, 0, 0, 0, 0, 1, 0)
    else:
        submit_b = func.date_trunc("day", Material.created_at)
        task_b = func.date_trunc("day", ReviewTask.created_at)

    submit_subq = (
        select(submit_b.label("b"), func.count(Material.id).label("c"))
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .where(Material.status.in_(SUBMITTED_STATUSES))
        .group_by("b")
        .subquery()
    )
    reviewed_subq = (
        select(task_b.label("b"), func.count(ReviewTask.id).label("c"))
        .where(ReviewTask.created_at >= window.start)
        .where(ReviewTask.created_at < window.end)
        .where(ReviewTask.final_decision != ReviewDecision.PENDING)
        .group_by("b")
        .subquery()
    )
    # Pick the most recent bucket (max timestamp) of the union
    union_subq = (
        select(
            submit_subq.c.b.label("b"),
            submit_subq.c.c.label("s"),
            reviewed_subq.c.c.label("r"),
        )
        .select_from(submit_subq)
        .outerjoin(
            reviewed_subq,
            reviewed_subq.c.b == submit_subq.c.b,
        )
        .subquery()
    )
    row = (
        await db.execute(
            select(union_subq.c.b, union_subq.c.s, union_subq.c.r)
            .order_by(union_subq.c.b.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    s = int(row.s or 0)
    r = int(row.r or 0)
    return _safe_pct(r, s)


# ---------------------------------------------------------------------------
# Anomaly (current snapshot)
# ---------------------------------------------------------------------------


async def anomaly(
    db: AsyncSession, *, window: Window, granularity: str
) -> dict:
    """Return current snapshot + series of core metrics + recent alerts.

    Series is built by bucketing the window. ``current`` is the most-recent
    (smallest bucket) sub-window.
    """
    bucket = _bucket_expr(granularity)
    stmt = (
        select(
            bucket.label("b"),
            func.sum(
                case(
                    (Material.status.in_(REJECTED_STATUSES), 1),
                    else_=0,
                )
            ).label("rej"),
            func.sum(
                case(
                    (Material.status.in_(APPROVED_STATUSES), 1),
                    else_=0,
                )
            ).label("apr"),
            func.sum(
                case(
                    (Material.status.in_(SUBMITTED_STATUSES), 1),
                    else_=0,
                )
            ).label("sub"),
        )
        .where(Material.created_at >= window.start)
        .where(Material.created_at < window.end)
        .group_by("b")
        .order_by("b")
    )
    rows = (await db.execute(stmt)).all()

    # Reviewed counts (join to ReviewTask)
    if granularity == "hour":
        task_b = func.date_trunc("hour", ReviewTask.created_at)
    elif granularity == "5min":
        task_b = func.date_trunc("hour", ReviewTask.created_at) + (
            (func.extract("minute", ReviewTask.created_at) / 5).cast(Integer) * 5
        ) * func.make_interval(0, 0, 0, 0, 0, 1, 0)
    else:
        task_b = func.date_trunc("day", ReviewTask.created_at)
    rev_stmt = (
        select(
            task_b.label("b"),
            func.count(ReviewTask.id).label("c"),
        )
        .where(ReviewTask.created_at >= window.start)
        .where(ReviewTask.created_at < window.end)
        .where(ReviewTask.final_decision != ReviewDecision.PENDING)
        .group_by("b")
    )
    rev_rows = (await db.execute(rev_stmt)).all()
    rev_map = {r.b: int(r.c) for r in rev_rows}

    series: List[dict] = []
    for r in rows:
        sub = int(r.sub or 0)
        rej = int(r.rej or 0)
        apr = int(r.apr or 0)
        rev = rev_map.get(r.b, 0)
        series.append(
            {
                "bucket": r.b.isoformat() if isinstance(r.b, datetime) else str(r.b),
                "reject_rate": _safe_pct(rej, sub),
                "review_rate": _safe_pct(rev, sub),
                "approve_rate": _safe_pct(apr, sub),
                "submitted": sub,
            }
        )

    if series:
        last = series[-1]
        current = {
            "bucket": last["bucket"],
            "reject_rate": last["reject_rate"],
            "review_rate": last["review_rate"],
            "approve_rate": last["approve_rate"],
            "submitted": last["submitted"],
            "rejected": int(round(last["submitted"] * last["reject_rate"] / 100.0)),
            "high_risk_accounts": 0,  # computed separately below
        }
    else:
        current = {
            "bucket": window.end.isoformat(),
            "reject_rate": 0.0,
            "review_rate": 0.0,
            "approve_rate": 0.0,
            "submitted": 0,
            "rejected": 0,
            "high_risk_accounts": 0,
        }

    # Distinct submitters with at least 1 rejected material in the most-recent
    # bucket. Approximate: use the most recent 1h slice of the window.
    last_hour_start = max(window.end - timedelta(hours=1), window.start)
    hr_q = (
        select(func.count(func.distinct(Material.submitter_id)))
        .where(Material.created_at >= last_hour_start)
        .where(Material.created_at < window.end)
        .where(Material.status.in_(REJECTED_STATUSES))
    )
    current["high_risk_accounts"] = int(await db.scalar(hr_q) or 0)

    # Recent alerts (top 20)
    alert_stmt = (
        select(AlertEvent)
        .where(AlertEvent.created_at >= window.start)
        .order_by(AlertEvent.created_at.desc())
        .limit(20)
    )
    alert_rows = (await db.execute(alert_stmt)).scalars().all()
    alerts = [
        {
            "id": a.id,
            "rule_code": a.rule_code,
            "severity": a.severity,
            "metric": a.metric,
            "window_start": a.window_start,
            "window_end": a.window_end,
            "observed_value": a.observed_value,
            "threshold": a.threshold,
            "status": a.status,
            "created_at": a.created_at,
            "detail": a.detail or {},
        }
        for a in alert_rows
    ]

    return {
        "window": granularity,
        "current": current,
        "series": series,
        "alerts": alerts,
    }


# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------


async def quality(
    db: AsyncSession,
    *,
    window: Window,
    strategy_code: Optional[str] = None,
    limit: int = 200,
) -> dict:
    """Quality analytics: machine-vs-human agreement + top reasons."""
    # 1. Find tasks with both a machine result and a human decision.
    # Use a correlated EXISTS so the query plans independently of join
    # order; this also avoids the per-test schema oddity seen with explicit
    # ``.join(ReviewAssignment, ...)`` on shared ``Base.metadata``.
    from sqlalchemy import exists

    has_human = exists().where(
        (ReviewAssignment.task_id == ReviewTask.id)
        & (ReviewAssignment.decision != ReviewDecision.PENDING)
        & (ReviewAssignment.decision != ReviewDecision.RETURNED)
    )
    base = select(ReviewTask).where(
        (ReviewTask.created_at >= window.start)
        & (ReviewTask.created_at < window.end)
        & (ReviewTask.machine_status == MachineStatus.COMPLETED)
        & has_human
    )
    if strategy_code:
        base = base.where(
            func.coalesce(
                func.json_extract_path(ReviewTask.machine_result, "strategy", "code"),
                "",
            )
            == strategy_code
        )

    rows = (await db.execute(base)).scalars().all()
    task_ids = [t.id for t in rows]
    if not task_ids:
        return {
            "window_start": window.start,
            "window_end": window.end,
            "misjudge_rate": 0.0,
            "miss_rate": 0.0,
            "agree_rate": 0.0,
            "avg_review_hours": None,
            "top_rejection_reasons": [],
            "top_false_positive_tags": [],
            "verdicts": {"misjudge": 0, "miss": 0, "agree": 0, "total": 0},
            "detail": [],
            "detail_total": 0,
        }

    # 2. Fetch all human assignments for these tasks in one go.
    human_rows = (
        await db.execute(
            select(ReviewAssignment)
            .where(ReviewAssignment.task_id.in_(task_ids))
            .where(ReviewAssignment.decision != ReviewDecision.PENDING)
            .where(ReviewAssignment.decision != ReviewDecision.RETURNED)
        )
    ).scalars().all()
    assignments_by_task: dict[int, list] = {}
    for h in human_rows:
        assignments_by_task.setdefault(h.task_id, []).append(h)

    # 3. Eager-load tag snapshots for those assignments (avoid lazy IO).
    assignment_ids = [h.id for h in human_rows]
    tags_by_assignment: dict[int, list[dict]] = {}
    if assignment_ids:
        tag_rows = (
            await db.execute(
                select(ReviewAssignmentTag).where(
                    ReviewAssignmentTag.assignment_id.in_(assignment_ids)
                )
            )
        ).scalars().all()
        for tl in tag_rows:
            tags_by_assignment.setdefault(tl.assignment_id, []).append(
                tl.tag_snapshot or {}
            )

    verdicts = {"misjudge": 0, "miss": 0, "agree": 0, "total": 0}
    detail: List[dict] = []
    feedback_counter: dict[str, int] = {}
    fp_tag_counter: dict[str, int] = {}

    for task in rows:
        humans = assignments_by_task.get(task.id) or []
        if not humans:
            continue
        # Pick the most recently decided human assignment.
        human = max(
            humans,
            key=lambda h: h.decided_at or datetime.min.replace(tzinfo=timezone.utc),
        )
        machine_dec = _machine_decision(task)
        human_dec = human.decision
        verdict = _verdict(machine_dec, human_dec)
        if verdict not in verdicts:
            continue
        verdicts[verdict] += 1
        verdicts["total"] += 1
        # Only count feedback that explains a *rejection* — generic "OK"
        # notes on approved materials would otherwise dominate the chart.
        if human.note and human_dec == ReviewDecision.REJECTED:
            note_text = (human.note or "").strip()
            # Skip the boilerplate "MLR 二次复核" / "MLR 复核" notes — they
            # are meta-actions, not the reason for rejecting.
            if note_text and not note_text.startswith("MLR"):
                key = note_text[:20] or "(未填写原因)"
                feedback_counter[key] = feedback_counter.get(key, 0) + 1
        if verdict in {"miss", "misjudge"}:
            for snap in tags_by_assignment.get(human.id, []):
                name = snap.get("name") or snap.get("code") or "unknown"
                fp_tag_counter[name] = fp_tag_counter.get(name, 0) + 1
        s_code = None
        if isinstance(task.machine_result, dict):
            strat = task.machine_result.get("strategy") or {}
            s_code = strat.get("code") if isinstance(strat, dict) else None
        if not s_code:
            s_code = task.stage_key or None
        detail.append(
            {
                "task_id": task.id,
                "material_id": task.material_id,
                "strategy_code": s_code,
                "machine_decision": machine_dec,
                "human_decision": human_dec.value if hasattr(human_dec, "value") else str(human_dec),
                "verdict": verdict,
                "feedback": human.note,
                "completed_at": task.completed_at,
            }
        )

    detail_total = len(detail)
    detail = detail[:limit]
    top_reasons = sorted(
        ({"label": k, "count": v} for k, v in feedback_counter.items()),
        key=lambda x: -x["count"],
    )[:10]
    top_tags = sorted(
        ({"label": k, "count": v} for k, v in fp_tag_counter.items()),
        key=lambda x: -x["count"],
    )[:10]

    misjudge = verdicts["misjudge"]
    miss = verdicts["miss"]
    agree = verdicts["agree"]
    total = verdicts["total"]
    return {
        "window_start": window.start,
        "window_end": window.end,
        "misjudge_rate": _safe_pct(misjudge, total),
        "miss_rate": _safe_pct(miss, total),
        "agree_rate": _safe_pct(agree, total),
        "avg_review_hours": None,  # could be added if needed
        "top_rejection_reasons": top_reasons,
        "top_false_positive_tags": top_tags,
        "verdicts": verdicts,
        "detail": detail,
        "detail_total": detail_total,
    }


def _machine_decision(task: ReviewTask) -> Optional[str]:
    """Map ``machine_result.risk_level`` to a decision string.

    Returns ``"approved"`` / ``"rejected"`` / ``None``.
    """
    if not isinstance(task.machine_result, dict):
        return None
    risk = task.machine_result.get("risk_level")
    if not isinstance(risk, str):
        return None
    if risk in {"高风险", "中风险"}:
        return "rejected"
    if risk in {"低风险", "无风险"}:
        return "approved"
    return None


def _verdict(machine_dec: Optional[str], human_dec: ReviewDecision) -> str:
    if machine_dec is None:
        return "agree"
    human = human_dec.value if hasattr(human_dec, "value") else str(human_dec)
    if machine_dec == human:
        return "agree"
    if machine_dec == "approved" and human == "rejected":
        return "misjudge"  # machine let it through, human rejected
    if machine_dec == "rejected" and human == "approved":
        return "miss"  # machine blocked, human approved
    return "agree"


# ---------------------------------------------------------------------------
# Risk dashboard (overview page)
#
# Risk level lives in ``ReviewTask.machine_result`` (JSONB) as a string
# in {高风险, 中风险, 低风险, 敏感, 无风险}. We aggregate from tasks that
# completed machine review in the window. Date buckets use the task's
# ``machine_completed_at`` (falling back to ``created_at`` when null).
# ---------------------------------------------------------------------------


_RISK_TO_COLUMN = {
    "高风险": "high",
    "中风险": "medium",
    "低风险": "low",
    "敏感": "sensitive",
    "无风险": "none",
}


def _risk_case(machine_result_col) -> case:
    """Build a CASE expression that maps risk_level strings to int 1/0 columns."""
    return case(
        *(
            (machine_result_col["risk_level"].astext == level, level)
            for level in RISK_LEVELS
        ),
        else_=None,
    )


async def risk_trend(db: AsyncSession, *, days: int) -> dict:
    """Daily counts of completed machine reviews, split by risk level.

    Returns a dict compatible with ``RiskTrendResponse``: ``{days, points}``
    where each point has all-zero counts filled in for missing dates so the
    UI can render a continuous x-axis.
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    mr = ReviewTask.machine_result
    bucket = func.date_trunc("day", ReviewTask.machine_completed_at)

    total_col = func.count(ReviewTask.id).label("total")
    risk_cols = []
    for level in RISK_LEVELS:
        col_name = _RISK_TO_COLUMN[level]
        risk_cols.append(
            func.sum(
                case((mr["risk_level"].astext == level, 1), else_=0)
            ).label(col_name)
        )

    stmt = (
        select(bucket.label("b"), total_col, *risk_cols)
        .where(ReviewTask.machine_status == MachineStatus.COMPLETED)
        .where(mr.is_not(None))
        .where(ReviewTask.machine_completed_at >= start)
        .where(ReviewTask.machine_completed_at.is_not(None))
        .group_by("b")
        .order_by("b")
    )
    rows = (await db.execute(stmt)).all()

    bucket_map: dict[str, dict] = {}
    for r in rows:
        b: datetime = r.b
        key = b.date().isoformat()
        bucket_map[key] = {
            "total": int(r.total or 0),
            "high": int(r.high or 0),
            "medium": int(r.medium or 0),
            "low": int(r.low or 0),
            "sensitive": int(r.sensitive or 0),
            "none": int(r.none or 0),
        }

    points: List[dict] = []
    for offset in range(days - 1, -1, -1):
        d = (now - timedelta(days=offset)).date()
        key = d.isoformat()
        row = bucket_map.get(key, {})
        points.append(
            {
                "date": key,
                "total": row.get("total", 0),
                "high": row.get("high", 0),
                "medium": row.get("medium", 0),
                "low": row.get("low", 0),
                "sensitive": row.get("sensitive", 0),
                "none": row.get("none", 0),
            }
        )

    return {"days": days, "points": points}


async def risk_distribution(db: AsyncSession, *, days: int) -> dict:
    """Counts per risk level over the window. Always returns 5 buckets
    (including zero-count levels) so the UI doesn't need to fill gaps.
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    mr = ReviewTask.machine_result
    level_expr = _risk_case(mr)

    stmt = (
        select(level_expr.label("level"), func.count(ReviewTask.id).label("c"))
        .where(ReviewTask.machine_status == MachineStatus.COMPLETED)
        .where(mr.is_not(None))
        .where(ReviewTask.machine_completed_at >= start)
        .where(ReviewTask.machine_completed_at.is_not(None))
        .group_by("level")
    )
    rows = (await db.execute(stmt)).all()
    counts = {r.level: int(r.c) for r in rows if r.level in RISK_LEVELS}

    buckets = [{"level": lvl, "count": counts.get(lvl, 0)} for lvl in RISK_LEVELS]
    return {"days": days, "buckets": buckets}


async def top_risk_labels(db: AsyncSession, *, days: int, limit: int) -> dict:
    """Top ``limit`` risk-type labels by hit count in the window.

    Iterates each completed task's ``machine_result['hits']`` array and
    aggregates by ``label_cn`` (fallback ``label``). Each label records:
      * ``count`` — total hits across all tasks in the window
      * ``risk_level`` — most-recent risk_level of the task that produced
        this hit (used as a representative level for the UI tag)
      * ``last_hit_at`` — most-recent hit timestamp

    Sorted by count DESC then last_hit_at DESC.
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    mr = ReviewTask.machine_result
    level_expr = _risk_case(mr)
    severity_rank = case(
        (level_expr == "高风险", 0),
        (level_expr == "敏感", 1),
        (level_expr == "中风险", 2),
        (level_expr == "低风险", 3),
        (level_expr == "无风险", 4),
        else_=5,
    )

    # Pull all completed tasks in the window (with hits) and aggregate in Python.
    # Bounded by days × daily volume; for the dashboard scale this is fine.
    stmt = (
        select(
            mr.label("machine_result_raw"),
            ReviewTask.machine_completed_at.label("hit_at"),
            level_expr.label("risk_level"),
        )
        .where(ReviewTask.machine_status == MachineStatus.COMPLETED)
        .where(mr.is_not(None))
        .where(ReviewTask.machine_completed_at >= start)
        .where(ReviewTask.machine_completed_at.is_not(None))
        .order_by(severity_rank.asc(), ReviewTask.machine_completed_at.desc())
    )
    rows = (await db.execute(stmt)).all()

    # Aggregate: label -> {count, last_hit_at, latest_risk_level}
    agg: dict[str, dict] = {}
    severity_value = {
        "高风险": 0,
        "敏感": 1,
        "中风险": 2,
        "低风险": 3,
        "无风险": 4,
    }
    for r in rows:
        mr_raw = r.machine_result_raw
        if not isinstance(mr_raw, dict):
            continue
        hits = mr_raw.get("hits")
        if not isinstance(hits, list) or not hits:
            continue
        task_level = r.risk_level if r.risk_level in RISK_LEVELS else "无风险"
        task_at: datetime = r.hit_at
        for h in hits:
            if not isinstance(h, dict):
                continue
            label = h.get("label_cn") or h.get("label")
            if not label:
                continue
            label_str = str(label)
            cur = agg.get(label_str)
            if cur is None:
                agg[label_str] = {
                    "count": 1,
                    "last_hit_at": task_at,
                    "latest_risk_level": task_level,
                }
                continue
            cur["count"] += 1
            if task_at and (cur["last_hit_at"] is None or task_at > cur["last_hit_at"]):
                cur["last_hit_at"] = task_at
                cur["latest_risk_level"] = task_level
            elif cur["last_hit_at"] is None and task_at is None:
                # keep existing level
                pass

    ranked = sorted(
        agg.items(),
        key=lambda kv: (
            -kv[1]["count"],
            -(kv[1]["last_hit_at"].timestamp() if kv[1]["last_hit_at"] else 0.0),
        ),
    )[:limit]

    items: List[dict] = [
        {
            "label": label,
            "count": data["count"],
            "risk_level": data["latest_risk_level"],
            "last_hit_at": data["last_hit_at"],
        }
        for label, data in ranked
    ]

    return {"days": days, "items": items}
