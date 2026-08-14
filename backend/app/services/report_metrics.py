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

from sqlalchemy import Integer, String, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert_event import AlertEvent
from app.models.material import Material, MaterialStatus, MaterialVersion
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
# Audit modality — derived from MaterialType + MaterialVersion.mime_type.
# 5 buckets: image / text / video / audio / document.
# ---------------------------------------------------------------------------

AUDIT_MODALITIES: tuple[str, ...] = ("image", "text", "video", "audio", "document")
"""审核模态（5 选）: 与 MaterialType 的差异:
- ``document`` 折叠所有 office/PDF/HTML 等业务"文档"类型.
- ``audio``   由 mime_type 派生 (audio/*), 不在 MaterialType 枚举中.
- ``text``    包含 TEXT + mime:text/* + 派生为文本的 PDF.
"""

# mime → 业务所属模态的映射. 优先级: 派生自 mime_type 时最优先; 缺失时
# 退到 MaterialType. SQL 端用 ilike 模式; 这里只做文档化.
_AUDIO_MIME_PATTERNS = ("audio/%",)
_VIDEO_MIME_PATTERNS = ("video/%",)
_IMAGE_MIME_PATTERNS = ("image/%",)
_TEXT_MIME_PATTERNS = ("text/%",)
# document: 业务约定走 PDF + office + html 类型; mime 前缀白名单
_DOCUMENT_MIME_PATTERNS = (
    "application/pdf",
    "application/msword",
    "application/vnd.ms-",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/rtf",
    "text/html",
    "application/xhtml",
)


def audit_modality_for_material(material_type: Optional[str], mime_type: Optional[str]) -> Optional[str]:
    """派生单条素材的审核模态. 仅供 Python 侧单条判断 / 文档 / 测试使用."""
    if mime_type:
        mt = mime_type.lower()
        if mt.startswith("audio/"):
            return "audio"
        if mt.startswith("video/"):
            return "video"
        if mt.startswith("image/"):
            return "image"
        if mt.startswith("text/"):
            return "text"
        if any(mt == p or mt.startswith(p) for p in _DOCUMENT_MIME_PATTERNS):
            return "document"
    if material_type is None:
        return None
    mt = str(material_type).lower()
    if mt == "image":
        return "image"
    if mt == "video":
        return "video"
    if mt == "pdf":
        return "document"
    if mt == "text":
        return "text"
    return None


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

# Hard cap on a custom-range window. Matches the upper bound used by
# ``/reports/risk/trend`` (days ≤ 90) so we never run a multi-month
# aggregation without a deliberate cap.
MAX_CUSTOM_WINDOW = timedelta(days=90)


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


def resolve_custom_window(
    start: datetime,
    end: datetime,
    *,
    now: Optional[datetime] = None,
) -> Window:
    """Validate and return an absolute ``[start, end)`` window.

    Both timestamps must be timezone-aware. ``end`` must be strictly after
    ``start`` and the span must not exceed ``MAX_CUSTOM_WINDOW`` (90 days).
    Naive datetimes are treated as UTC.
    """
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end <= start:
        raise ValueError("end must be strictly after start")
    if (end - start) > MAX_CUSTOM_WINDOW:
        raise ValueError(
            f"custom window exceeds {MAX_CUSTOM_WINDOW.days}-day cap"
        )
    current = now or datetime.now(timezone.utc)
    if end > current:
        # Snap end to "now" so we never return a window that points into
        # the future — keeps the response shape consistent with the
        # shorthand variants, which always end at ``now``.
        end = current
    return Window(start=start, end=end)


def bucket_granularity(window: Window) -> str:
    """Pick hour vs day buckets based on window span."""
    hours = window.duration.total_seconds() / 3600
    if hours <= 6:
        return "5min"
    if hours <= 48:
        return "hour"
    return "day"


# ---------------------------------------------------------------------------
# Risk-trend granularity helpers (hour/day/month) — separate from the generic
# bucket_granularity which only emits {5min, hour, day}.
# ---------------------------------------------------------------------------


def pick_risk_trend_granularity(window: Window) -> str:
    """Pick hour/day/month for the trend page based on span.

    Defaults: ≤ 48h → hour, ≤ 31d → day, otherwise month. The UI may explicitly
    override via the ``granularity`` query parameter.
    """
    hours = window.duration.total_seconds() / 3600
    if hours <= 48:
        return "hour"
    if hours <= 24 * 31:
        return "day"
    return "month"


def _requested_at_expr():
    """Time anchor for the trend page: ``machine_started_at`` if non-null,
    otherwise ``created_at``. Aligned with the wider "请求时间" semantics
    used by the inspection result query page."""
    return func.coalesce(ReviewTask.machine_started_at, ReviewTask.created_at)


def _risk_trend_bucket_col(granularity: str):
    """Bucket start as a UTC-tagged timestamp.

    The DB server's session timezone may not be UTC, so we first re-anchor
    the timestamp to UTC via ``AT TIME ZONE 'UTC'`` (which yields a naive
    timestamp in UTC wall-clock time), then truncate to the requested
    granularity. The result is wrapped in AT TIME ZONE 'UTC' to return a
    UTC-tagged timestamptz so the value round-trips to a tz-aware Python
    datetime.
    """
    expr = _requested_at_expr()
    if granularity == "hour":
        trunc = func.date_trunc("hour", expr.op("AT TIME ZONE")("UTC"))
    elif granularity == "month":
        trunc = func.date_trunc("month", expr.op("AT TIME ZONE")("UTC"))
    else:
        trunc = func.date_trunc("day", expr.op("AT TIME ZONE")("UTC"))
    return trunc.op("AT TIME ZONE")("UTC")


def _iter_buckets(window: Window, granularity: str):
    """Yield (start, end) tuples for every bucket in the window.

    Buckets are aligned to the same truncation as the SQL bucket column so the
    Python-side name keys match the database-rendered bucket start times.
    Window.start is floored to the bucket boundary as long as it falls within
    the window's elapsed range.
    """
    cur = _floor_to_bucket(window.start, granularity)
    delta: timedelta
    if granularity == "hour":
        delta = timedelta(hours=1)
    elif granularity == "month":
        delta = None  # iterate by month math
    else:
        delta = timedelta(days=1)

    while cur < window.end:
        if granularity == "month":
            # advance to next month, anchored at 1st 00:00 UTC
            if cur.month == 12:
                nxt = cur.replace(year=cur.year + 1, month=1, day=1)
            else:
                nxt = cur.replace(month=cur.month + 1, day=1)
        else:
            nxt = cur + delta
        yield (cur, min(nxt, window.end))
        cur = nxt


def _floor_to_bucket(value: datetime, granularity: str) -> datetime:
    """Floor ``value`` to the start of its bucket boundary (UTC)."""
    if granularity == "hour":
        return value.replace(minute=0, second=0, microsecond=0)
    if granularity == "month":
        return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


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
    db: AsyncSession,
    *,
    window: Window,
    granularity: str = "hour",
    modalities: Optional[Sequence[str]] = None,
    strategy_codes: Optional[Sequence[str]] = None,
    account_ids: Optional[Sequence[str]] = None,
    ips: Optional[Sequence[str]] = None,
    channels: Optional[Sequence[str]] = None,
    risk_label_paths: Optional[Sequence[str]] = None,
    taxonomy: Optional[List] = None,
) -> dict:
    """Return current snapshot + series of core metrics + recent alerts.

    Series is built by bucketing the window. ``current`` is the most-recent
    (smallest bucket) sub-window.

    The 5 filter dimensions mirror :func:`risk_trend`:

      * ``modalities``        — 5 选 (image/text/video/audio/document)
      * ``strategy_codes``    — by ``machine_result['strategy']['code']`` or FK
      * ``account_ids`` / ``ips`` / ``channels``
                               — by ``material.metadata`` JSONB
      * ``risk_label_paths``  — by `machine_result` JSONB content

    Granularity is restricted to ``hour`` / ``day`` (no 5min / month):
    anomaly windows only span 1h / 24h / 7d so finer / coarser buckets are
    not useful.
    """
    from sqlalchemy import and_ as _and_, exists as _exists, or_ as _or_
    from sqlalchemy import String as _String

    if granularity not in {"hour", "day"}:
        raise ValueError(f"unsupported granularity: {granularity}")

    bucket = _bucket_expr(granularity)

    # 指标公式 (与页面说明一致):
    # - 拒绝率 = 阻断(高风险) / total
    # - 通过率 = 通过(无风险+低风险) / total
    # - 审核率 = (阻断 + 通过) / total  (已有明确结论的比例)
    base = select(
        bucket.label("b"),
        func.sum(case((ReviewTask.machine_result["risk_level"].astext == "高风险", 1), else_=0)).label("rej"),
        func.sum(case((ReviewTask.machine_result["risk_level"].astext == "无风险", 1), else_=0)).label("apr_none"),
        func.sum(case((ReviewTask.machine_result["risk_level"].astext == "低风险", 1), else_=0)).label("apr_low"),
        func.count().label("sub"),
    ).select_from(
        Material.__table__.join(
            ReviewTask.__table__,
            ReviewTask.material_id == Material.id,
        )
    ).where(
        Material.created_at >= window.start
    ).where(
        Material.created_at < window.end
    ).where(
        ReviewTask.machine_status == MachineStatus.COMPLETED
    )

    if modalities:
        valid = set(AUDIT_MODALITIES)
        unknown = [m for m in modalities if m not in valid]
        if unknown:
            raise ValueError(f"unsupported modality: {', '.join(unknown)}")
        material_match = _build_modality_exists(list(modalities))
        if material_match is not None:
            base = base.where(material_match)

    if strategy_codes:
        from app.models.strategy import Strategy

        strategy_match = _exists().where(
            (ReviewTask.material_id == Material.id)
            & _or_(
                ReviewTask.machine_result["strategy"]["code"].astext.in_(list(strategy_codes)),
                ReviewTask.strategy_id.in_(
                    select(Strategy.id).where(Strategy.code.in_(list(strategy_codes)))
                ),
            )
        )
        base = base.where(strategy_match)

    if account_ids:
        base = base.where(
            _or_(*[Material.extra_metadata["account_id"].astext == a for a in account_ids])
        )

    if ips:
        base = base.where(
            _or_(*[Material.extra_metadata["ip"].astext == i for i in ips])
        )

    if channels:
        base = base.where(
            _or_(*[Material.extra_metadata["channel"].astext == c for c in channels])
        )

    stmt = base.group_by("b").order_by("b")
    rows = (await db.execute(stmt)).all()

    # 审核率 = (阻断 + 通过) / total = (rej + apr) / total
    rev_map: dict = {}

    series: List[dict] = []
    for r in rows:
        sub = int(r.sub or 0)
        rej = int(r.rej or 0)  # 高风险 = 阻断
        apr = int(r.apr_none or 0) + int(r.apr_low or 0)  # 无风险 + 低风险 = 通过
        # 审核率 = (阻断 + 通过) / total
        reviewed = rej + apr
        series.append(
            {
                "bucket": r.b.isoformat() if isinstance(r.b, datetime) else str(r.b),
                "reject_rate": _safe_pct(rej, sub),
                "review_rate": _safe_pct(reviewed, sub),
                "approve_rate": _safe_pct(apr, sub),
                "submitted": sub,
            }
        )

    if series:
        last = series[-1]
        # 高风险内容数 = 当前 bucket 的高风险条数 (直接从查询结果取, 不用 rate 反算)
        last_rej = int(rows[-1].rej or 0) if rows else 0
        current = {
            "bucket": last["bucket"],
            "reject_rate": last["reject_rate"],
            "review_rate": last["review_rate"],
            "approve_rate": last["approve_rate"],
            "submitted": last["submitted"],
            "rejected": last_rej,
            "high_risk_accounts": 0,
            "high_risk_content_count": last_rej,
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
            "high_risk_content_count": 0,
        }

    # Distinct submitters with at least 1 high-risk material in the
    # most-recent 1h slice. Based on machine_result.risk_level='高风险'.
    last_hour_start = max(window.end - timedelta(hours=1), window.start)
    hr_q = (
        select(func.count(func.distinct(Material.submitter_id)))
        .select_from(
            Material.__table__.join(
                ReviewTask.__table__,
                ReviewTask.material_id == Material.id,
            )
        )
        .where(Material.created_at >= last_hour_start)
        .where(Material.created_at < window.end)
        .where(ReviewTask.machine_status == MachineStatus.COMPLETED)
        .where(ReviewTask.machine_result["risk_level"].astext == "高风险")
    )
    if modalities:
        material_match = _build_modality_exists(list(modalities))
        if material_match is not None:
            hr_q = hr_q.where(material_match)
    if account_ids:
        hr_q = hr_q.where(
            _or_(
                *[Material.extra_metadata["account_id"].astext == a for a in account_ids]
            )
        )
    if ips:
        hr_q = hr_q.where(
            _or_(*[Material.extra_metadata["ip"].astext == i for i in ips])
        )
    if channels:
        hr_q = hr_q.where(
            _or_(
                *[Material.extra_metadata["channel"].astext == c for c in channels]
            )
        )
    current["high_risk_accounts"] = int(await db.scalar(hr_q) or 0)

    # high_risk_content_count 已从 series 最后一个 bucket 取值 (与 submitted 同口径),
    # 不再单独查询.

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
        "granularity": granularity,
        "window_start": window.start,
        "window_end": window.end,
        "applied": {
            "modalities": list(modalities or []),
            "strategy_codes": list(strategy_codes or []),
            "channels": list(channels or []),
            "account_ids": list(account_ids or []),
            "ips": list(ips or []),
            "risk_label_paths": list(risk_label_paths or []),
        },
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


async def risk_trend(
    db: AsyncSession,
    *,
    window: "Window",
    granularity: str = "day",
    modalities: Optional[Sequence[str]] = None,
    strategy_codes: Optional[Sequence[str]] = None,
    account_ids: Optional[Sequence[str]] = None,
    ips: Optional[Sequence[str]] = None,
    channels: Optional[Sequence[str]] = None,
    risk_label_paths: Optional[Sequence[str]] = None,
    taxonomy: Optional[List] = None,
) -> dict:
    """Trend of completed machine reviews, split by risk level.

    The 占比公式 documented in the spec is::
        ratio(level) = count(level) / sum(high + medium + low + none)
    so the response echoes a ``denominator`` per bucket (sum of the four
    reportable levels) and the per-level counts. ``敏感`` is surfaced in a
    separate field so the UI can show it as a non-percentage hint without
    polluting the percentage base.

    ``modalities`` (when non-empty) restricts the aggregation to the union of
    cases derived from ``material_version.mime_type`` and
    ``Material.material_type`` (see ``audit_modality_for_material``).
    ``strategy_codes`` matches via the FK first and falls back to the
    ``machine_result['strategy']['code']`` JSONB snapshot for legacy data.
    ``account_ids`` / ``ips`` / ``channels`` are matched against
    ``material.metadata['account_id']`` / ``['ip']`` / ``['channel']`` and
    thus require the metadata to be a JSONB column.
    ``risk_label_paths`` is a list of slash-joined ``risk_category/audit_item/
    audit_point`` codes; selecting a parent path implicitly includes all leaf
    descendants via prefix matching.
    """
    from sqlalchemy import exists as _exists

    if granularity not in {"hour", "day", "month"}:
        raise ValueError(f"unsupported granularity: {granularity}")

    mr = ReviewTask.machine_result
    bucket = _risk_trend_bucket_col(granularity)
    requested_at = _requested_at_expr()

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
        .where(requested_at >= window.start)
        .where(requested_at < window.end)
    )

    if modalities:
        valid = set(AUDIT_MODALITIES)
        unknown = [m for m in modalities if m not in valid]
        if unknown:
            raise ValueError(f"unsupported modality: {', '.join(unknown)}")
        material_match = _build_modality_exists(list(modalities))
        if material_match is not None:
            stmt = stmt.where(material_match)

    if strategy_codes:
        from app.models.strategy import Strategy

        stmt = stmt.where(
            or_(
                ReviewTask.machine_result["strategy"]["code"].astext.in_(list(strategy_codes)),
                ReviewTask.strategy_id.in_(
                    select(Strategy.id).where(Strategy.code.in_(list(strategy_codes)))
                ),
            )
        )

    if account_ids:
        # Match JSONB text values; the schema is freeform so we COALESCE
        # text/null to text and use equality.
        acct_clauses = [
            Material.extra_metadata["account_id"].astext == a for a in account_ids
        ]
        account_match = _exists().where(
            (Material.id == ReviewTask.material_id) & or_(*acct_clauses)
        )
        stmt = stmt.where(account_match)

    if ips:
        ip_clauses = [
            Material.extra_metadata["ip"].astext == i for i in ips
        ]
        ip_match = _exists().where(
            (Material.id == ReviewTask.material_id) & or_(*ip_clauses)
        )
        stmt = stmt.where(ip_match)

    if channels:
        ch_clauses = [
            Material.extra_metadata["channel"].astext == c for c in channels
        ]
        channel_match = _exists().where(
            (Material.id == ReviewTask.material_id) & or_(*ch_clauses)
        )
        stmt = stmt.where(channel_match)

    if risk_label_paths:
        from app.services.risk_taxonomy_service import collect_point_codes_under_paths

        point_codes = (
            collect_point_codes_under_paths(taxonomy, list(risk_label_paths))
            if taxonomy is not None else []
        )
        if not point_codes:
            stmt = stmt.where(False)
        else:
            clauses = [
                ReviewTask.machine_result.contains(
                    {"hits": [{"audit_point_code": code}]}
                )
                for code in point_codes
            ]
            stmt = stmt.where(or_(*clauses))

    stmt = stmt.group_by("b").order_by("b")
    rows = (await db.execute(stmt)).all()

    bucket_map: dict[str, dict] = {}
    for r in rows:
        b: datetime = r.b
        key = b.isoformat()
        bucket_map[key] = {
            "total": int(r.total or 0),
            "high": int(r.high or 0),
            "medium": int(r.medium or 0),
            "low": int(r.low or 0),
            "sensitive": int(r.sensitive or 0),
            "none": int(r.none or 0),
        }

    points: List[dict] = []
    for cur, _ in _iter_buckets(window, granularity):
        key = cur.isoformat()
        row = bucket_map.get(key, {})
        high = row.get("high", 0)
        medium = row.get("medium", 0)
        low = row.get("low", 0)
        sensitive = row.get("sensitive", 0)
        none = row.get("none", 0)
        points.append(
            {
                "bucket": key,
                "total": row.get("total", 0),
                "denominator": high + medium + low + none,
                "high": high,
                "medium": medium,
                "low": low,
                "sensitive": sensitive,
                "none": none,
            }
        )

    return {
        "granularity": granularity,
        "window_start": window.start,
        "window_end": window.end,
        "applied": {
            "modalities": list(modalities or []),
            "strategy_codes": list(strategy_codes or []),
            "account_ids": list(account_ids or []),
            "ips": list(ips or []),
            "channels": list(channels or []),
            "risk_label_paths": list(risk_label_paths or []),
        },
        "points": points,
    }


def _build_modality_exists(modalities: List[str]):
    """Build an EXISTS clause restricting review tasks to one of the given
    审核模态 (image/text/video/audio/document)."""
    from sqlalchemy import exists as _exists

    if not modalities:
        return None
    clauses = []
    for m in modalities:
        if m == "audio":
            clauses.append(MaterialVersion.mime_type.ilike("audio/%"))
        elif m == "video":
            clauses.append(
                or_(
                    MaterialVersion.mime_type.ilike("video/%"),
                    and_(
                        MaterialVersion.mime_type.is_(None),
                        Material.material_type == "video",
                    ),
                )
            )
        elif m == "image":
            clauses.append(
                or_(
                    MaterialVersion.mime_type.ilike("image/%"),
                    and_(
                        MaterialVersion.mime_type.is_(None),
                        Material.material_type == "image",
                    ),
                )
            )
        elif m == "text":
            clauses.append(
                or_(
                    MaterialVersion.mime_type.ilike("text/%"),
                    and_(
                        MaterialVersion.mime_type.is_(None),
                        Material.material_type.in_(["text", "pdf"]),
                    ),
                )
            )
        elif m == "document":
            doc_patterns = [
                "application/pdf",
                "application/msword",
                "application/vnd.ms-",
                "application/vnd.openxmlformats-officedocument",
                "application/vnd.ms-excel",
                "application/vnd.ms-powerpoint",
                "application/rtf",
                "text/html",
                "application/xhtml",
            ]
            doc_clauses = [MaterialVersion.mime_type.ilike(f"{p}%") for p in doc_patterns]
            clauses.append(
                or_(
                    *doc_clauses,
                    and_(
                        MaterialVersion.mime_type.is_(None),
                        Material.material_type == "pdf",
                    ),
                )
            )

    return _exists().where(
        (Material.id == ReviewTask.material_id)
        & (MaterialVersion.material_id == Material.id)
        & or_(*clauses)
    )


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


async def top_risk_labels(
    db: AsyncSession,
    *,
    days: int = 7,
    limit: int = 10,
    modalities: Optional[Sequence[str]] = None,
    strategy_codes: Optional[Sequence[str]] = None,
    account_ids: Optional[Sequence[str]] = None,
    ips: Optional[Sequence[str]] = None,
    channels: Optional[Sequence[str]] = None,
    risk_label_paths: Optional[Sequence[str]] = None,
    taxonomy: Optional[List] = None,
) -> dict:
    """Top ``limit`` risk-type labels by hit count in the window.

    Iterates each completed task's ``machine_result['hits']`` array and
    aggregates by ``label_cn`` (fallback ``label``). Each label records:
      * ``count`` — total hits across all tasks in the window
      * ``risk_level`` — most-recent risk_level of the task that produced
        this hit (used as a representative level for the UI tag)
      * ``last_hit_at`` — most-recent hit timestamp

    Sorted by count DESC then last_hit_at DESC.

    ``modalities`` / ``strategy_codes`` / ``account_ids`` / ``ips`` /
    ``channels`` apply the same EXISTS-based filters as ``risk_trend``.
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

    if modalities:
        valid = set(AUDIT_MODALITIES)
        unknown = [m for m in modalities if m not in valid]
        if unknown:
            raise ValueError(f"unsupported modality: {', '.join(unknown)}")
        material_match = _build_modality_exists(list(modalities))
        if material_match is not None:
            stmt = stmt.where(material_match)

    if strategy_codes:
        from app.models.strategy import Strategy as _Strategy

        stmt = stmt.where(
            or_(
                ReviewTask.machine_result["strategy"]["code"].astext.in_(
                    list(strategy_codes)
                ),
                ReviewTask.strategy_id.in_(
                    select(_Strategy.id).where(
                        _Strategy.code.in_(list(strategy_codes))
                    )
                ),
            )
        )

    if account_ids or ips or channels:
        from sqlalchemy import exists as _exists

        if account_ids:
            acct_clauses = [
                Material.extra_metadata["account_id"].astext == a for a in account_ids
            ]
            acct_match = _exists().where(
                (Material.id == ReviewTask.material_id) & or_(*acct_clauses)
            )
            stmt = stmt.where(acct_match)

        if ips:
            ip_clauses = [Material.extra_metadata["ip"].astext == i for i in ips]
            ip_match = _exists().where(
                (Material.id == ReviewTask.material_id) & or_(*ip_clauses)
            )
            stmt = stmt.where(ip_match)

        if channels:
            ch_clauses = [
                Material.extra_metadata["channel"].astext == c for c in channels
            ]
            ch_match = _exists().where(
                (Material.id == ReviewTask.material_id) & or_(*ch_clauses)
            )
            stmt = stmt.where(ch_match)

    if risk_label_paths:
        from app.services.risk_taxonomy_service import collect_point_codes_under_paths

        point_codes = (
            collect_point_codes_under_paths(taxonomy, list(risk_label_paths))
            if taxonomy is not None else []
        )
        if not point_codes:
            stmt = stmt.where(False)
        else:
            clauses = [
                ReviewTask.machine_result.contains(
                    {"hits": [{"audit_point_code": code}]}
                )
                for code in point_codes
            ]
            stmt = stmt.where(or_(*clauses))

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

    # 计算总命中数 (用于百分比)
    total_hits = sum(d["count"] for _, d in ranked)

    items: List[dict] = [
        {
            "label": label,
            "count": data["count"],
            "risk_level": data["latest_risk_level"],
            "last_hit_at": data["last_hit_at"],
            "percentage": round((data["count"] / total_hits * 100), 2) if total_hits > 0 else 0.0,
        }
        for label, data in ranked
    ]

    return {"days": days, "items": items}


# ---------------------------------------------------------------------------
# Trend tab option helpers
# ---------------------------------------------------------------------------


async def distinct_channels(db: AsyncSession, *, limit: int = 200) -> List[str]:
    """Distinct ``material.metadata['channel']`` values seen in the DB.

    Channels are free-form business values (模型输入 / 模型输出 / 小红书 / 电商 …),
    so we simply de-dup across all rows. Missing values are skipped.
    """
    from sqlalchemy import String as _String

    channel = Material.extra_metadata["channel"].astext
    stmt = (
        select(channel.label("ch"))
        .where(channel.is_not(None))
        .group_by(channel)
        .order_by(channel)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [r.ch for r in rows if r.ch]


async def distinct_account_ids(db: AsyncSession, *, limit: int = 500) -> List[str]:
    """Distinct ``material.metadata['account_id']`` values seen in the DB.

    See :func:`distinct_channels` for the same free-form rationale.
    """
    acct = Material.extra_metadata["account_id"].astext
    stmt = (
        select(acct.label("a"))
        .where(acct.is_not(None))
        .group_by(acct)
        .order_by(acct)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [r.a for r in rows if r.a]


async def distinct_ips(db: AsyncSession, *, limit: int = 500) -> List[str]:
    """Distinct ``material.metadata['ip']`` values seen in the DB."""
    ip = Material.extra_metadata["ip"].astext
    stmt = (
        select(ip.label("i"))
        .where(ip.is_not(None))
        .group_by(ip)
        .order_by(ip)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [r.i for r in rows if r.i]


async def risk_label_taxonomy(db: AsyncSession) -> List[dict]:
    """Build the three-level risk label tree from audit_items + audit_points.

    Delegates to the shared ``risk_taxonomy_service.load_risk_taxonomy``
    and converts ``RiskTaxonomyNode`` objects to plain dicts for JSON
    serialization.
    """
    from app.services.risk_taxonomy_service import load_risk_taxonomy

    nodes = await load_risk_taxonomy(db)

    def _node_to_dict(node) -> dict:
        return {
            "code": node.code,
            "label": node.label,
            "path": node.path,
            "children": [_node_to_dict(c) for c in node.children],
        }

    return [_node_to_dict(n) for n in nodes]


# ---------------------------------------------------------------------------
# Root-cause aggregations — used by /api/v1/alerts/{id}/root-cause.
#
# Three rule codes map to three different drill-downs:
#   * reject_rate_high                 → top risk labels
#   * high_risk_content_high           → top accounts (rejected)
#   * high_risk_account_concentration  → top accounts → their top IPs
#
# The window is the alert's own ``window_start ~ window_end`` (typically a
# few minutes to an hour). The functions below also accept optional cohort
# filters (modality / strategy_code / channel) so the root cause reflects
# the cohort that triggered the alert.
# ---------------------------------------------------------------------------


async def top_risk_labels_by_window(
    db: AsyncSession,
    *,
    start: datetime,
    end: datetime,
    modality: Optional[str] = None,
    strategy_code: Optional[str] = None,
    limit: int = 10,
) -> List[dict]:
    """Top risk labels hit in [start, end).

    Mirrors :func:`top_risk_labels` but bounded by an explicit interval
    and optional cohort filters. ``modality`` and ``strategy_code`` are
    applied via the same EXISTS-based patterns as the trend / distribution
    endpoints.
    """
    from sqlalchemy import exists as _exists

    mr = ReviewTask.machine_result
    stmt = (
        select(
            mr.label("machine_result_raw"),
            ReviewTask.machine_completed_at.label("hit_at"),
        )
        .where(ReviewTask.machine_status == MachineStatus.COMPLETED)
        .where(mr.is_not(None))
        .where(ReviewTask.machine_completed_at >= start)
        .where(ReviewTask.machine_completed_at < end)
        .where(ReviewTask.machine_completed_at.is_not(None))
    )

    if modality:
        match = _build_modality_exists([modality])
        if match is not None:
            stmt = stmt.where(
                _exists().where(
                    (Material.id == ReviewTask.material_id) & match
                )
            )

    if strategy_code:
        from app.models.strategy import Strategy

        stmt = stmt.where(
            or_(
                ReviewTask.machine_result["strategy"]["code"].astext == strategy_code,
                ReviewTask.strategy_id.in_(
                    select(Strategy.id).where(Strategy.code == strategy_code)
                ),
            )
        )

    rows = (await db.execute(stmt)).all()

    agg: dict[str, dict] = {}
    for r in rows:
        mr_raw = r.machine_result_raw
        if not isinstance(mr_raw, dict):
            continue
        hits = mr_raw.get("hits")
        if not isinstance(hits, list) or not hits:
            continue
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
                agg[label_str] = {"count": 1, "last_hit_at": task_at}
            else:
                cur["count"] += 1
                if task_at and (cur["last_hit_at"] is None or task_at > cur["last_hit_at"]):
                    cur["last_hit_at"] = task_at

    ranked = sorted(
        agg.items(),
        key=lambda kv: (
            -kv[1]["count"],
            -(kv[1]["last_hit_at"].timestamp() if kv[1]["last_hit_at"] else 0.0),
        ),
    )[:limit]

    return [
        {
            "label": label,
            "count": data["count"],
            "last_hit_at": data["last_hit_at"],
        }
        for label, data in ranked
    ]


async def top_accounts_by_window(
    db: AsyncSession,
    *,
    start: datetime,
    end: datetime,
    modality: Optional[str] = None,
    strategy_code: Optional[str] = None,
    channel: Optional[str] = None,
    limit: int = 10,
) -> List[dict]:
    """Top ``account_id`` by submission volume in [start, end).

    Returns ``{account_id, submitted, rejected}`` per row, sorted by
    rejected DESC then submitted DESC.
    """
    from sqlalchemy import exists as _exists

    acct = Material.extra_metadata["account_id"].astext
    stmt = (
        select(
            acct.label("account_id"),
            func.count(Material.id).label("sub"),
            func.sum(
                case(
                    (Material.status.in_(REJECTED_STATUSES), 1),
                    else_=0,
                )
            ).label("rej"),
        )
        .where(Material.created_at >= start)
        .where(Material.created_at < end)
        .where(acct.is_not(None))
        .group_by(acct)
    )

    if modality:
        match = _build_modality_exists([modality])
        if match is not None:
            stmt = stmt.where(match)

    if strategy_code:
        from app.models.strategy import Strategy

        # Strategy filters via the most recent review task on the material.
        stmt = stmt.where(
            _exists().where(
                (ReviewTask.material_id == Material.id)
                & or_(
                    ReviewTask.machine_result["strategy"]["code"].astext == strategy_code,
                    ReviewTask.strategy_id.in_(
                        select(Strategy.id).where(Strategy.code == strategy_code)
                    ),
                )
            )
        )

    if channel:
        stmt = stmt.where(Material.extra_metadata["channel"].astext == channel)

    rows = (await db.execute(stmt)).all()

    items = [
        {
            "account_id": r.account_id,
            "submitted": int(r.sub or 0),
            "rejected": int(r.rej or 0),
        }
        for r in rows
        if r.account_id
    ]
    items.sort(key=lambda x: (-x["rejected"], -x["submitted"]))
    return items[:limit]


async def top_accounts_by_ip_by_window(
    db: AsyncSession,
    *,
    start: datetime,
    end: datetime,
    modality: Optional[str] = None,
    strategy_code: Optional[str] = None,
    channel: Optional[str] = None,
    limit: int = 5,
    per_account_ip_limit: int = 3,
) -> List[dict]:
    """Top accounts → their top IPs.

    Returns a flat list of ``{account_id, ip, submitted, rejected}`` rows.
    The per-account IP cap is ``per_account_ip_limit``; the total row cap
    is ``limit`` (top accounts by rejections).
    """
    from sqlalchemy import exists as _exists

    acct = Material.extra_metadata["account_id"].astext
    ip = Material.extra_metadata["ip"].astext

    # 1. Find top accounts by rejection count.
    top_accounts = await top_accounts_by_window(
        db,
        start=start,
        end=end,
        modality=modality,
        strategy_code=strategy_code,
        channel=channel,
        limit=limit,
    )
    if not top_accounts:
        return []

    account_ids = [a["account_id"] for a in top_accounts]

    # 2. For these accounts, find their top IPs.
    stmt = (
        select(
            acct.label("account_id"),
            ip.label("ip"),
            func.count(Material.id).label("sub"),
            func.sum(
                case(
                    (Material.status.in_(REJECTED_STATUSES), 1),
                    else_=0,
                )
            ).label("rej"),
        )
        .where(Material.created_at >= start)
        .where(Material.created_at < end)
        .where(acct.in_(account_ids))
        .where(ip.is_not(None))
        .group_by(acct, ip)
        .order_by(func.sum(case((Material.status.in_(REJECTED_STATUSES), 1), else_=0)).desc())
    )

    rows = (await db.execute(stmt)).all()

    # 3. Group by account_id, cap per-account IPs.
    by_account: dict[str, dict] = {}
    for r in rows:
        if not r.account_id or not r.ip:
            continue
        cur = by_account.setdefault(r.account_id, {"count": 0, "rows": []})
        cur["count"] += 1
        if len(cur["rows"]) < per_account_ip_limit:
            cur["rows"].append(
                {
                    "account_id": r.account_id,
                    "ip": r.ip,
                    "submitted": int(r.sub or 0),
                    "rejected": int(r.rej or 0),
                }
            )

    # 4. Flatten in top_accounts order.
    out: List[dict] = []
    for a in top_accounts:
        out.extend(by_account.get(a["account_id"], {}).get("rows", []))
    return out
