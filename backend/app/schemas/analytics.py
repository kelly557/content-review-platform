"""Schemas for the Analytics page (formerly Reports).

Endpoints under ``/api/v1/reports`` power three tabs:
  1. 趋势分析 (Trend)   — daily/hourly time series of core metrics.
  2. 异常分析 (Anomaly)  — current-hour snapshot + recent alert events.
  3. 质量分析 (Quality)  — machine vs human agreement, false-positive/negative
                            breakdown, top rejection reasons.

All schemas are Pydantic v2 (``BaseModel``) and use ``snake_case`` fields
to stay consistent with the rest of the API.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase, Page


# ---------------------------------------------------------------------------
# Common
# ---------------------------------------------------------------------------


class OverviewStats(BaseModel):
    """Top of the analytics page — single point in time, no series."""

    total_materials: int = 0
    in_review: int = 0
    approved: int = 0
    rejected: int = 0
    submitted: int = 0
    avg_review_hours: Optional[float] = None
    reject_rate: float = 0.0
    review_rate: float = 0.0
    approve_rate: float = 0.0


# ---------------------------------------------------------------------------
# Risk dashboard (overview page)
# ---------------------------------------------------------------------------


RISK_LEVELS: tuple[str, ...] = ("高风险", "中风险", "低风险", "敏感", "无风险")


class RiskTrendPoint(BaseModel):
    """One time bucket's risk counts. ``bucket`` is always a UTC ISO 8601
    timestamp marking the start of the bucket.

    Only the four levels required by the 占比公式 are reported
    (高/中/低/无风险); ``敏感`` is intentionally aggregated into a separate
    ``sensitive`` field so the UI can show it without affecting the percentage
    base. ``total`` is the count of all completed machine reviews in the
    bucket (whatever risk_level); ``denominator`` is the sum of the four
    reportable levels and is the base for the percentage formula.
    """

    bucket: str
    total: int = 0
    denominator: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    sensitive: int = 0
    none: int = 0


class AppliedFilters(BaseModel):
    """Echo of the resolved filter set so the UI can render a chip strip."""

    modalities: List[str] = Field(default_factory=list)
    strategy_codes: List[str] = Field(default_factory=list)
    account_ids: List[str] = Field(default_factory=list)
    ips: List[str] = Field(default_factory=list)
    channels: List[str] = Field(default_factory=list)
    risk_label_paths: List[str] = Field(default_factory=list)


class RiskTrendResponse(BaseModel):
    granularity: str
    window_start: datetime
    window_end: datetime
    applied: AppliedFilters = Field(default_factory=AppliedFilters)
    points: List[RiskTrendPoint] = Field(default_factory=list)


class RiskBucket(BaseModel):
    level: str  # one of RISK_LEVELS
    count: int = 0


class RiskDistributionResponse(BaseModel):
    days: int
    buckets: List[RiskBucket] = Field(default_factory=list)


class TopRiskLabelItem(BaseModel):
    """Top risk-type aggregation: one hit label and how often it fired."""

    label: str
    count: int = 0
    risk_level: str  # most recent risk_level observed for this label in window
    last_hit_at: datetime


class TopRiskLabelsResponse(BaseModel):
    days: int
    items: List[TopRiskLabelItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 趋势分析
# ---------------------------------------------------------------------------


class TrendPoint(BaseModel):
    """One bucket in a trend series.

    ``value`` is a percentage in 0..100 for rate metrics, or a raw count
    for the ``submitted`` metric. ``sample_count`` is the denominator
    (number of submitted materials in the bucket) so the UI can show
    a confidence hint when the bucket is sparse.
    """

    bucket: str
    value: float
    sample_count: int = 0


class TrendResponse(BaseModel):
    metric: str
    granularity: str
    window_start: datetime
    window_end: datetime
    points: List[TrendPoint] = Field(default_factory=list)
    delta_pct: Optional[float] = None  # change vs previous equivalent window


# ---------------------------------------------------------------------------
# 异常分析
# ---------------------------------------------------------------------------


class AnomalyMetricPoint(BaseModel):
    """One observation within the current anomaly window."""

    bucket: str
    reject_rate: float = 0.0
    review_rate: float = 0.0
    approve_rate: float = 0.0
    submitted: int = 0


class AnomalyCurrent(BaseModel):
    """Snapshot of the most recent (smallest) bucket."""

    bucket: str
    reject_rate: float = 0.0
    review_rate: float = 0.0
    approve_rate: float = 0.0
    submitted: int = 0
    rejected: int = 0
    high_risk_accounts: int = 0  # distinct submitters with ≥1 rejection in this bucket
    high_risk_content_count: int = 0  # distinct materials with machine_result.risk_level == '高风险' in latest bucket


class AnomalyAlertSummary(BaseModel):
    id: int
    rule_code: str
    severity: str
    metric: str
    window_start: datetime
    window_end: datetime
    observed_value: float
    threshold: float
    status: str
    created_at: datetime
    detail: Dict[str, Any] = Field(default_factory=dict)


class AnomalyAppliedFilters(BaseModel):
    """Echo of the resolved filter set so the UI can render a chip strip.

    Mirrors the structure on the trend page so the frontend can reuse a
    single ``AnomalyAppliedFilters`` shape across both analytics endpoints.
    """

    modalities: List[str] = Field(default_factory=list)
    strategy_codes: List[str] = Field(default_factory=list)
    channels: List[str] = Field(default_factory=list)
    account_ids: List[str] = Field(default_factory=list)
    ips: List[str] = Field(default_factory=list)
    risk_label_paths: List[str] = Field(default_factory=list)


class AnomalyResponse(BaseModel):
    window: str
    granularity: str
    window_start: datetime
    window_end: datetime
    applied: AnomalyAppliedFilters = Field(default_factory=AnomalyAppliedFilters)
    current: AnomalyCurrent
    series: List[AnomalyMetricPoint]
    alerts: List[AnomalyAlertSummary]


# ---------------------------------------------------------------------------
# 质量分析
# ---------------------------------------------------------------------------


class ReasonCount(BaseModel):
    label: str
    count: int


class QualityVerdictCount(BaseModel):
    misjudge: int = 0   # machine=APPROVED, human=REJECTED  (false negative for risk)
    miss: int = 0       # machine=REJECTED, human=APPROVED  (false positive for risk)
    agree: int = 0      # machine == human
    total: int = 0


class QualityDetailRow(BaseModel):
    task_id: int
    material_id: int
    strategy_code: Optional[str] = None
    machine_decision: Optional[str] = None
    human_decision: Optional[str] = None
    verdict: str  # "misjudge" | "miss" | "agree"
    feedback: Optional[str] = None
    completed_at: Optional[datetime] = None


class QualityResponse(BaseModel):
    window_start: datetime
    window_end: datetime
    misjudge_rate: float = 0.0
    miss_rate: float = 0.0
    agree_rate: float = 0.0
    avg_review_hours: Optional[float] = None
    top_rejection_reasons: List[ReasonCount] = Field(default_factory=list)
    top_false_positive_tags: List[ReasonCount] = Field(default_factory=list)
    verdicts: QualityVerdictCount = Field(default_factory=QualityVerdictCount)
    detail: List[QualityDetailRow] = Field(default_factory=list)
    detail_total: int = 0
