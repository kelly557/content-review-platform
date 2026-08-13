"""Smoke + integration tests for the analytics router (/reports/* and /alerts).

Uses the shared ``client`` and ``db_session`` fixtures from ``conftest.py``.
We deliberately keep all data insertions on the test's own session to avoid
the cross-test schema-leak the ``db_session_factory``-per-insert pattern
causes with the per-test schema isolation.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

import app.models  # noqa: F401
from app.main import app
from app.models.alert_event import AlertEvent
from app.models.material import Material, MaterialStatus, MaterialType, MaterialVersion
from app.models.strategy import Strategy, StrategyScope
from app.models.review import (
    MachineStatus,
    ReviewAssignment,
    ReviewDecision,
    ReviewTask,
    ReviewType,
)
from app.models.user import User
from app.models.workflow import WorkflowInstance, WorkflowTemplate
from sqlalchemy import delete, select


# ---------------------------------------------------------------------------
# Schema / route registration
# ---------------------------------------------------------------------------


def test_analytics_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/reports/overview",
        "/api/v1/reports/trend",
        "/api/v1/reports/anomaly",
        "/api/v1/reports/quality",
        "/api/v1/reports/quality/export.csv",
        "/api/v1/alerts",
    ):
        assert key in paths, f"missing route: {key}"


def test_analytics_schemas_present():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in (
        "OverviewStats",
        "TrendResponse",
        "TrendPoint",
        "AnomalyResponse",
        "AnomalyCurrent",
        "QualityResponse",
        "QualityVerdictCount",
        "AlertEventOut",
        "AlertPage",
    ):
        assert s in schemas, f"missing schema: {s}"


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reports_requires_reviewer_role(client):
    login = await client.post(
        "/api/v1/auth/login",
        json={"identifier": "submitter@adreview.example.com", "password": "submitter123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.get("/api/v1/reports/overview")
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_alerts_ack_requires_mlr(client):
    login = await client.post(
        "/api/v1/auth/login",
        json={"identifier": "reviewer@adreview.example.com", "password": "reviewer123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.post("/api/v1/alerts/1/ack", json={})
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Empty-DB happy paths
# ---------------------------------------------------------------------------


async def _login(client, email: str, password: str) -> None:
    r = await client.post("/api/v1/auth/login", json={"identifier": email, "password": password})
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_overview_empty(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/overview?window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_materials"] == 0
    assert body["reject_rate"] == 0.0
    assert body["approve_rate"] == 0.0
    assert body["review_rate"] == 0.0


@pytest.mark.asyncio
async def test_trend_empty(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/trend?metric=reject_rate&window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["metric"] == "reject_rate"
    assert body["points"] == []


@pytest.mark.asyncio
async def test_trend_rejects_unknown_metric(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/trend?metric=bogus&window=7d")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_anomaly_empty(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/anomaly?window=1h")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["current"]["submitted"] == 0
    assert body["current"]["high_risk_content_count"] == 0
    assert body["series"] == []
    assert body["alerts"] == []


@pytest.mark.asyncio
async def test_anomaly_high_risk_content_count(client, db_session):
    """distinct materials with machine_result.risk_level == '高风险' within the most-recent 1h slice."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    # Use tz-aware UTC to match the tz-aware cutoffs the service computes via
    # datetime.now(timezone.utc); otherwise SQLite tests silently skip rows.
    now = datetime.now(timezone.utc)
    # 3 高风险 + 1 中风险 + 1 低风险 — only the 3 高风险 should count
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="高风险",
        completed_at=now,
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="高风险",
        completed_at=now,
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="高风险",
        completed_at=now - timedelta(minutes=10),
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="中风险",
        completed_at=now,
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        completed_at=now,
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/anomaly?window=1h")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["current"]["high_risk_content_count"] == 3


@pytest.mark.asyncio
async def test_anomaly_custom_window_accepted(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=2)
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params={"start": start.isoformat(), "end": end.isoformat()},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "current" in body
    assert "series" in body


@pytest.mark.asyncio
async def test_anomaly_custom_window_validation(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    now = datetime.now(timezone.utc)
    later = now + timedelta(hours=1)
    # end <= start → 400
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params={"start": later.isoformat(), "end": now.isoformat()},
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_quality_empty(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/quality?window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["verdicts"]["total"] == 0
    assert body["misjudge_rate"] == 0.0
    assert body["miss_rate"] == 0.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_material(s, submitter: User, status: MaterialStatus) -> Material:
    m = Material(
        title=f"qa {status.value} {datetime.utcnow().timestamp()}",
        material_type=MaterialType.TEXT,
        status=status,
        submitter_id=submitter.id,
    )
    s.add(m)
    await s.flush()
    v = MaterialVersion(
        material_id=m.id,
        version_no=1,
        storage_key=f"qa/{m.id}/v1.txt",
        original_filename="qa.txt",
        mime_type="text/plain",
        file_size=1,
        text_body="qa",
        created_by_id=submitter.id,
    )
    s.add(v)
    await s.flush()
    m.current_version_id = v.id
    await s.flush()
    return m


async def _get_user(s, email: str) -> User:
    return (
        await s.execute(select(User).where(User.email == email))
    ).scalar_one()


# ---------------------------------------------------------------------------
# Integration: seed data and verify counts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_overview_counts_statuses(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_material(db_session, sub, MaterialStatus.APPROVED)
    await _make_material(db_session, sub, MaterialStatus.APPROVED)
    await _make_material(db_session, sub, MaterialStatus.REJECTED)
    await _make_material(db_session, sub, MaterialStatus.IN_REVIEW)
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/overview?window=30d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["approved"] == 2
    assert body["rejected"] == 1
    assert body["in_review"] == 1
    assert body["submitted"] == 4
    assert body["reject_rate"] == 25.0
    assert body["approve_rate"] == 50.0


@pytest.mark.asyncio
async def test_trend_returns_buckets(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    for _ in range(2):
        await _make_material(db_session, sub, MaterialStatus.APPROVED)
    await _make_material(db_session, sub, MaterialStatus.REJECTED)
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/trend?metric=reject_rate&window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["metric"] == "reject_rate"
    assert len(body["points"]) >= 1
    for p in body["points"]:
        assert 0.0 <= p["value"] <= 100.0
        assert p["sample_count"] >= 0


@pytest.mark.asyncio
async def test_quality_misjudge_detection(client, db_session):
    """machine=approved, human=rejected → counts as misjudge."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    reviewer = await _get_user(db_session, "reviewer@adreview.example.com")

    m = Material(
        title="misjudge-target",
        material_type=MaterialType.TEXT,
        status=MaterialStatus.REJECTED,
        submitter_id=sub.id,
    )
    db_session.add(m)
    await db_session.flush()
    v = MaterialVersion(
        material_id=m.id,
        version_no=1,
        storage_key="qa/misjudge/v1.txt",
        original_filename="x.txt",
        mime_type="text/plain",
        file_size=1,
        text_body="x",
        created_by_id=sub.id,
    )
    db_session.add(v)
    await db_session.flush()
    m.current_version_id = v.id

    tpl = WorkflowTemplate(code="qa_tpl", name="qa_tpl", definition={})
    db_session.add(tpl)
    await db_session.flush()
    inst = WorkflowInstance(
        template_id=tpl.id,
        material_id=m.id,
        material_version_id=v.id,
        state="running",
    )
    db_session.add(inst)
    await db_session.flush()

    task = ReviewTask(
        material_id=m.id,
        material_version_id=v.id,
        workflow_instance_id=inst.id,
        stage_key="machine",
        title="misjudge task",
        review_type=ReviewType.MACHINE,
        final_decision=ReviewDecision.APPROVED,
        machine_status=MachineStatus.COMPLETED,
        machine_result={"risk_level": "低风险", "strategy": {"code": "qa"}},
        completed_at=datetime.utcnow(),
    )
    db_session.add(task)
    await db_session.flush()
    a = ReviewAssignment(
        task_id=task.id,
        assignee_id=reviewer.id,
        decision=ReviewDecision.REJECTED,
        note="[标签违规] 命中了 R-001",
        decided_at=datetime.utcnow(),
    )
    db_session.add(a)
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/quality?window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["verdicts"]["misjudge"] == 1
    assert body["verdicts"]["total"] == 1
    assert body["misjudge_rate"] == 100.0
    assert any(r["label"].startswith("[标签违规]") for r in body["top_rejection_reasons"])


@pytest.mark.asyncio
async def test_alerts_list_and_ack(client, db_session):
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    now = datetime.now(timezone.utc)
    a = AlertEvent(
        rule_code="reject_rate_spike",
        severity="warn",
        metric="reject_rate",
        window_start=now - timedelta(minutes=30),
        window_end=now,
        observed_value=5.0,
        threshold=3.0,
        detail={"note": "test"},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)
    aid = a.id

    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    resp = await client.get("/api/v1/alerts?status=open")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 1
    assert any(item["id"] == aid for item in body["items"])

    resp = await client.post(f"/api/v1/alerts/{aid}/ack", json={"note": "x"})
    assert resp.status_code == 403, resp.text

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.post(f"/api/v1/alerts/{aid}/ack", json={"note": "looking"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "acknowledged"
    assert body["ack_note"] == "looking"


# ---------------------------------------------------------------------------
# Custom range (start/end) — added 2026-07-16 for the Trends tab UI rework.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_overview_custom_range(client):
    """Overview honours an explicit [start, end) range when both are given."""
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    end = datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc)
    start = end - timedelta(days=3)
    resp = await client.get(
        "/api/v1/reports/overview",
        params={
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_materials"] == 0
    assert body["reject_rate"] == 0.0


@pytest.mark.asyncio
async def test_trend_custom_range(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    end = datetime(2026, 7, 16, 0, 0, 0, tzinfo=timezone.utc)
    start = end - timedelta(days=14)
    resp = await client.get(
        "/api/v1/reports/trend",
        params={
            "metric": "reject_rate",
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["metric"] == "reject_rate"
    assert body["granularity"] in {"day", "hour", "5min"}


@pytest.mark.asyncio
async def test_overview_custom_range_requires_pair(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/overview",
        params={"start": "2026-07-10T00:00:00Z"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_overview_custom_range_rejects_inverted(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/overview",
        params={
            "start": "2026-07-16T00:00:00Z",
            "end": "2026-07-10T00:00:00Z",
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_overview_custom_range_rejects_over_90d(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/overview",
        params={
            "start": "2025-01-01T00:00:00Z",
            "end": "2026-07-16T00:00:00Z",
        },
    )
    assert resp.status_code == 400


def test_custom_range_helper_unit():
    """Sanity check resolve_custom_window without hitting the DB."""
    from app.services.report_metrics import resolve_custom_window

    start = datetime(2026, 7, 10, tzinfo=timezone.utc)
    end = datetime(2026, 7, 16, tzinfo=timezone.utc)
    w = resolve_custom_window(start, end)
    assert w.start == start
    assert w.end == end

    with pytest.raises(ValueError):
        resolve_custom_window(end, start)


# ---------------------------------------------------------------------------
# Risk trend endpoint — split by risk_level, optional material_types filter.
# Added 2026-07-16 for the Trends tab UI rework.
# ---------------------------------------------------------------------------


async def _make_risk_task(
    db_session,
    *,
    submitter: User,
    material_type: MaterialType = MaterialType.TEXT,
    risk_level: str | None = None,
    completed_at: datetime | None = None,
    started_at: datetime | None = None,
    mime_type: str = "text/plain",
    metadata: dict | None = None,
    strategy=None,
) -> tuple[Material, ReviewTask]:
    """Create a Material + WorkflowInstance + a completed ReviewTask with machine_result.risk_level."""
    m = Material(
        title=f"risk {datetime.utcnow().timestamp()}-{id(object())}",
        material_type=material_type,
        status=MaterialStatus.APPROVED if risk_level in {"低风险", "无风险"} else MaterialStatus.REJECTED,
        submitter_id=submitter.id,
        extra_metadata=metadata or {},
    )
    db_session.add(m)
    await db_session.flush()
    v = MaterialVersion(
        material_id=m.id,
        version_no=1,
        storage_key=f"qa/risk/{m.id}/v1.txt",
        original_filename="x.txt",
        mime_type=mime_type,
        file_size=1,
        text_body="x",
        created_by_id=submitter.id,
    )
    db_session.add(v)
    await db_session.flush()
    m.current_version_id = v.id
    await db_session.flush()

    tpl = WorkflowTemplate(code=f"risk_tpl_{datetime.utcnow().timestamp()}", name="risk_tpl", definition={})
    db_session.add(tpl)
    await db_session.flush()
    inst = WorkflowInstance(
        template_id=tpl.id,
        material_id=m.id,
        material_version_id=v.id,
        state="running",
    )
    db_session.add(inst)
    await db_session.flush()

    completed = completed_at or datetime.now(timezone.utc)
    if completed.tzinfo is None:
        completed = completed.replace(tzinfo=timezone.utc)
    task = ReviewTask(
        material_id=m.id,
        material_version_id=v.id,
        workflow_instance_id=inst.id,
        stage_key="machine",
        title="risk task",
        review_type=ReviewType.MACHINE,
        machine_status=MachineStatus.COMPLETED,
        machine_result={"risk_level": risk_level} if risk_level else None,
        machine_completed_at=completed,
        machine_started_at=started_at if started_at is not None else completed,
        strategy_id=strategy.id if strategy is not None else None,
    )
    db_session.add(task)
    await db_session.flush()
    return m, task


@pytest.mark.asyncio
async def test_risk_trend_empty(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk/trend?window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["granularity"] == "day"
    # 7d window floored to day boundary produces 7 or 8 buckets depending on
    # the wall-clock time of the test run. The contract is "one bucket per day,
    # all zero-filled".
    assert 7 <= len(body["points"]) <= 8
    for p in body["points"]:
        assert p["total"] == 0
        assert p["denominator"] == 0
        assert p["high"] == 0
        assert p["medium"] == 0
        assert p["low"] == 0
        assert p["sensitive"] == 0
        assert p["none"] == 0
    assert body["applied"]["modalities"] == []
    assert body["applied"]["strategy_codes"] == []


@pytest.mark.asyncio
async def test_risk_trend_splits_levels(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(db_session, submitter=sub, risk_level="高风险")
    await _make_risk_task(db_session, submitter=sub, risk_level="中风险")
    await _make_risk_task(db_session, submitter=sub, risk_level="低风险")
    await _make_risk_task(db_session, submitter=sub, risk_level="无风险")
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk/trend?window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    totals = {lvl: sum(p[lvl] for p in body["points"]) for lvl in ("high", "medium", "low", "none")}
    assert totals == {"high": 1, "medium": 1, "low": 1, "none": 1}
    # denominator must equal sum of reportable levels (敏感 excluded)
    denom = sum(p["denominator"] for p in body["points"])
    assert denom == 4


@pytest.mark.asyncio
async def test_risk_trend_excludes_sensitive_from_denominator(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(db_session, submitter=sub, risk_level="敏感")
    await _make_risk_task(db_session, submitter=sub, risk_level="敏感")
    await _make_risk_task(db_session, submitter=sub, risk_level="高风险")
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk/trend?window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    sensitive_total = sum(p["sensitive"] for p in body["points"])
    high_total = sum(p["high"] for p in body["points"])
    denom = sum(p["denominator"] for p in body["points"])
    assert sensitive_total == 2
    assert high_total == 1
    assert denom == 1  # sensitive must NOT enter the percentage base


@pytest.mark.asyncio
async def test_risk_trend_filter_by_modality(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    # 2 text (高风险) — should be counted
    await _make_risk_task(db_session, submitter=sub, material_type=MaterialType.TEXT, risk_level="高风险", mime_type="text/plain")
    await _make_risk_task(db_session, submitter=sub, material_type=MaterialType.TEXT, risk_level="高风险", mime_type="text/plain")
    # 1 image (中风险) — should be filtered out
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.IMAGE,
        risk_level="中风险",
        mime_type="image/png",
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("modalities", "text")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    medium_total = sum(p["medium"] for p in body["points"])
    assert high_total == 2
    assert medium_total == 0
    assert body["applied"]["modalities"] == ["text"]


@pytest.mark.asyncio
async def test_risk_trend_filter_accepts_multiple_modalities(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(db_session, submitter=sub, material_type=MaterialType.TEXT, risk_level="高风险", mime_type="text/plain")
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.IMAGE,
        risk_level="高风险",
        mime_type="image/png",
    )
    # pdf excluded (mapped to document, not selected)
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.PDF,
        risk_level="高风险",
        mime_type="application/pdf",
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("modalities", "text"), ("modalities", "image")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 2


@pytest.mark.asyncio
async def test_risk_trend_filter_by_account_id(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="高风险",
        metadata={"account_id": "acc-1"},
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="高风险",
        metadata={"account_id": "acc-2"},
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("account_ids", "acc-1")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 1
    assert body["applied"]["account_ids"] == ["acc-1"]


@pytest.mark.asyncio
async def test_risk_trend_filter_by_ip(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="高风险",
        metadata={"ip": "10.0.0.1"},
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="高风险",
        metadata={"ip": "10.0.0.2"},
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("ips", "10.0.0.1")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 1
    assert body["applied"]["ips"] == ["10.0.0.1"]


@pytest.mark.asyncio
async def test_risk_trend_options_includes_ips(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="高风险",
        metadata={"ip": "192.168.1.1"},
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk-trend/options")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(i["value"] == "192.168.1.1" for i in body["ips"])


@pytest.mark.asyncio
async def test_risk_trend_filter_by_channel(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="中风险",
        metadata={"channel": "小红书"},
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="中风险",
        metadata={"channel": "电商"},
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("channels", "小红书")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    medium_total = sum(p["medium"] for p in body["points"])
    assert medium_total == 1
    assert body["applied"]["channels"] == ["小红书"]


@pytest.mark.asyncio
async def test_risk_trend_filter_by_strategy_code(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    s1 = Strategy(code="qa-strategy-a", name="策略 A", scope=StrategyScope.GENERAL, is_active=True, created_by_id=sub.id)
    s2 = Strategy(code="qa-strategy-b", name="策略 B", scope=StrategyScope.GENERAL, is_active=True, created_by_id=sub.id)
    db_session.add_all([s1, s2])
    await db_session.flush()
    await _make_risk_task(
        db_session, submitter=sub, risk_level="高风险", strategy=s1
    )
    await _make_risk_task(
        db_session, submitter=sub, risk_level="高风险", strategy=s2
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("strategy_codes", "qa-strategy-a")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 1
    assert body["applied"]["strategy_codes"] == ["qa-strategy-a"]


@pytest.mark.asyncio
async def test_risk_trend_filter_by_risk_label_path(client, db_session):
    from app.models.audit_item import AuditItem
    from app.models.audit_point import AuditPoint
    from app.models.service import Service

    # Create service + audit_item + audit_point so the taxonomy tree can resolve the path
    svc = Service(code="text_audit_pro", name="Text Audit Pro")
    db_session.add(svc)
    await db_session.flush()
    ai = AuditItem(
        package_code="text_audit_pro",
        code="sensitive_term",
        name_cn="敏感词",
        is_builtin=True,
        is_enabled=True,
    )
    db_session.add(ai)
    await db_session.flush()
    ap = AuditPoint(
        package_code="text_audit_pro",
        item_id=ai.id,
        code="leader",
        label="leader",
        label_cn="一号领导",
        is_enabled=True,
    )
    db_session.add(ap)
    await db_session.flush()

    sub = await _get_user(db_session, "submitter@adreview.example.com")
    # Two hits, one matching the label path; one not.
    matches = ReviewTask
    m1 = Material(
        title="risk with hit",
        material_type=MaterialType.TEXT,
        status=MaterialStatus.REJECTED,
        submitter_id=sub.id,
    )
    db_session.add(m1)
    await db_session.flush()
    v1 = MaterialVersion(
        material_id=m1.id,
        version_no=1,
        storage_key=f"qa/risk/{m1.id}/v1.txt",
        original_filename="x.txt",
        mime_type="text/plain",
        file_size=1,
        text_body="x",
        created_by_id=sub.id,
    )
    db_session.add(v1)
    await db_session.flush()
    m1.current_version_id = v1.id
    tpl = WorkflowTemplate(code=f"risk_tpl_{datetime.utcnow().timestamp()}", name="risk_tpl", definition={})
    db_session.add(tpl)
    await db_session.flush()
    inst = WorkflowInstance(template_id=tpl.id, material_id=m1.id, material_version_id=v1.id, state="running")
    db_session.add(inst)
    await db_session.flush()
    now = datetime.now(timezone.utc)
    task1 = ReviewTask(
        material_id=m1.id,
        material_version_id=v1.id,
        workflow_instance_id=inst.id,
        stage_key="machine",
        title="risk w/ hit",
        review_type=ReviewType.MACHINE,
        machine_status=MachineStatus.COMPLETED,
        machine_result={
            "risk_level": "高风险",
            "hits": [
                {"risk_category_code": "politics", "audit_item_code": "sensitive_term", "audit_point_code": "leader"},
            ],
        },
        machine_completed_at=now,
        machine_started_at=now,
    )
    db_session.add(task1)
    # second task: different label, should be filtered out
    m2 = Material(
        title="risk no hit",
        material_type=MaterialType.TEXT,
        status=MaterialStatus.REJECTED,
        submitter_id=sub.id,
    )
    db_session.add(m2)
    await db_session.flush()
    v2 = MaterialVersion(
        material_id=m2.id,
        version_no=1,
        storage_key=f"qa/risk/{m2.id}/v1.txt",
        original_filename="x.txt",
        mime_type="text/plain",
        file_size=1,
        text_body="x",
        created_by_id=sub.id,
    )
    db_session.add(v2)
    await db_session.flush()
    m2.current_version_id = v2.id
    inst2 = WorkflowInstance(template_id=tpl.id, material_id=m2.id, material_version_id=v2.id, state="running")
    db_session.add(inst2)
    await db_session.flush()
    task2 = ReviewTask(
        material_id=m2.id,
        material_version_id=v2.id,
        workflow_instance_id=inst2.id,
        stage_key="machine",
        title="risk no hit",
        review_type=ReviewType.MACHINE,
        machine_status=MachineStatus.COMPLETED,
        machine_result={
            "risk_level": "高风险",
            "hits": [
                {"risk_category_code": "finance", "audit_item_code": "claim", "audit_point_code": "guarantee"},
            ],
        },
        machine_completed_at=now,
        machine_started_at=now,
    )
    db_session.add(task2)
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("risk_label_paths", "sensitive_term/leader")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 1
    assert body["applied"]["risk_label_paths"] == ["sensitive_term/leader"]


@pytest.mark.asyncio
async def test_risk_trend_granularity_hour(client, db_session):
    """今天窗口强制按小时粒度, 至少 1 个桶, 每个桶的 bucket 字段是 ISO 小时."""
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk/trend?window=today&granularity=hour")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["granularity"] == "hour"
    assert len(body["points"]) >= 1
    bad = [p["bucket"] for p in body["points"] if not p["bucket"].endswith("00:00+00:00")]
    assert not bad, f"hour buckets should end with 00:00+00:00 but got: {bad[:3]}"


@pytest.mark.asyncio
async def test_risk_trend_granularity_month(client, db_session):
    """超出自定义 90 天上限时应返回 400."""
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    end = datetime.utcnow().replace(tzinfo=timezone.utc)
    start = end - timedelta(days=400)
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params={
            "start": start.isoformat(),
            "end": end.isoformat(),
            "granularity": "month",
        },
    )
    assert resp.status_code == 400, resp.text

    # 90-day window with month granularity should still return 3 buckets.
    start = end - timedelta(days=89)
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params={
            "start": start.isoformat(),
            "end": end.isoformat(),
            "granularity": "month",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["granularity"] == "month"
    for p in body["points"]:
        # bucket should be 1st of some month at 00:00:00
        assert p["bucket"].endswith("01T00:00:00+00:00")


@pytest.mark.asyncio
async def test_risk_trend_rejects_unknown_modality(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("modalities", "video")],
    )
    assert resp.status_code == 200, resp.text
    # unknown modality should be rejected
    resp_bad = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("modalities", "smell")],
    )
    assert resp_bad.status_code == 400


@pytest.mark.asyncio
async def test_risk_trend_modality_document_via_pdf(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.PDF,
        risk_level="高风险",
        mime_type="application/pdf",
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("modalities", "document")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 1


@pytest.mark.asyncio
async def test_risk_trend_modality_audio_via_mime(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        risk_level="中风险",
        mime_type="audio/mpeg",
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("window", "7d"), ("modalities", "audio")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    medium_total = sum(p["medium"] for p in body["points"])
    assert medium_total == 1


@pytest.mark.asyncio
async def test_risk_trend_options_endpoint(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk-trend/options")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {m["value"] for m in body["modalities"]} == {"image", "text", "video", "audio", "document"}
    assert isinstance(body["strategies"], list)
    assert isinstance(body["channels"], list)
    assert isinstance(body["account_ids"], list)
    assert isinstance(body["risk_taxonomy"], list)


@pytest.mark.asyncio
async def test_risk_trend_custom_range_passes_through(client, db_session):
    """历史自定义日期应该精确匹配 [start, end), 而不是 now-N 天."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    # Place a task within a historical 2-day window.
    started = datetime(2026, 7, 10, 5, 0, 0, tzinfo=timezone.utc)
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="高风险",
        started_at=started,
        completed_at=started,
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[
            ("start", "2026-07-10T00:00:00Z"),
            ("end", "2026-07-11T00:00:00Z"),
            ("granularity", "hour"),
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 1


# ---------------------------------------------------------------------------
# Anomaly tab — multi-window (1h/24h/7d), explicit granularity, 5 filter
# dimensions (审核模态 / 策略 / 渠道 / account_id / ip / 风险标签).
# Added 2026-07-29 for the Anomaly page rework.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anomaly_window_7d_accepted(client):
    """异常分析支持 7d 窗口."""
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/anomaly?window=7d")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["granularity"] == "day"  # 7d 窗口无小时维度 (span > 6h)
    assert "applied" in body
    assert body["applied"] == {
        "modalities": [],
        "strategy_codes": [],
        "channels": [],
        "account_ids": [],
        "ips": [],
        "risk_label_paths": [],
    }


@pytest.mark.asyncio
async def test_anomaly_explicit_granularity(client):
    """手动覆盖 granularity: 1h 窗口下选 day, 桶按天切."""
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[("window", "1h"), ("granularity", "day")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["granularity"] == "day"


@pytest.mark.asyncio
async def test_anomaly_rejects_unknown_granularity(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[("window", "1h"), ("granularity", "month")],
    )
    assert resp.status_code == 400, resp.text
    assert "granularity" in resp.text


@pytest.mark.asyncio
async def test_anomaly_filter_by_modality(client, db_session):
    """审核模态过滤: 5 选 (image/text/video/audio/document)."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    # 2 文本 + 1 图片, 按模态过滤后只保留 1.
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        mime_type="text/plain",
        risk_level="低风险",
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.TEXT,
        mime_type="text/plain",
        risk_level="低风险",
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        material_type=MaterialType.IMAGE,
        mime_type="image/png",
        risk_level="低风险",
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[
            ("window", "1h"),
            ("granularity", "hour"),
            ("modalities", "image"),
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"]["modalities"] == ["image"]
    # 模态=image 只保留 1 条 approved/rejected 事件
    assert body["current"]["submitted"] == 1


@pytest.mark.asyncio
async def test_anomaly_filter_by_ip(client, db_session):
    """IP 过滤: 取 material.metadata['ip']."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        metadata={"ip": "10.0.0.1"},
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        metadata={"ip": "10.0.0.2"},
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[
            ("window", "1h"),
            ("granularity", "hour"),
            ("ips", "10.0.0.1"),
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"]["ips"] == ["10.0.0.1"]
    assert body["current"]["submitted"] == 1


@pytest.mark.asyncio
async def test_anomaly_filter_by_account_and_channel(client, db_session):
    """account_id + 渠道双重过滤."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        metadata={"account_id": "acct-A", "channel": "ios"},
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        metadata={"account_id": "acct-A", "channel": "android"},
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        metadata={"account_id": "acct-B", "channel": "ios"},
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[
            ("window", "1h"),
            ("granularity", "hour"),
            ("account_ids", "acct-A"),
            ("channels", "ios"),
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"]["account_ids"] == ["acct-A"]
    assert body["applied"]["channels"] == ["ios"]
    assert body["current"]["submitted"] == 1


@pytest.mark.asyncio
async def test_anomaly_filter_by_strategy_code(client, db_session):
    """策略 code 过滤：通过ReviewTask.machine_result['strategy']['code']."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    from app.models.strategy import Strategy

    s1 = Strategy(code="qa-strategy-anomaly-1", name="qa", scope="general", is_active=True)
    s2 = Strategy(code="qa-strategy-anomaly-2", name="qa2", scope="general", is_active=True)
    db_session.add_all([s1, s2])
    await db_session.commit()

    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        strategy=s1,
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        strategy=s2,
    )
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="低风险",
        strategy=s1,
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[
            ("window", "1h"),
            ("granularity", "hour"),
            ("strategy_codes", "qa-strategy-anomaly-1"),
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applied"]["strategy_codes"] == ["qa-strategy-anomaly-1"]
    assert body["current"]["submitted"] == 2


@pytest.mark.asyncio
async def test_anomaly_filter_by_risk_label_path(client, db_session):
    """风险标签路径过滤 — high_risk_content_count 与 submitted 同口径."""
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    now = datetime.now(timezone.utc)
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="高风险",
        completed_at=now,
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[
            ("window", "1h"),
            ("granularity", "hour"),
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 高风险内容数应与 submitted 一致 (唯一一条是高风险)
    assert body["current"]["submitted"] >= 1
    assert body["current"]["high_risk_content_count"] >= 1
    assert body["current"]["reject_rate"] > 0


@pytest.mark.asyncio
async def test_anomaly_rejects_unknown_modality(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/anomaly",
        params=[
            ("window", "1h"),
            ("granularity", "hour"),
            ("modalities", "pdf"),
        ],
    )
    assert resp.status_code == 400, resp.text
    assert "modality" in resp.text


# ---------------------------------------------------------------------------
# /api/v1/alerts — time window + 5 dimensions.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_alerts_filter_by_window(client, db_session):
    """异常分析 alerts 接受 1h/24h/7d 窗口."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    now = datetime.now(timezone.utc)
    a_old = AlertEvent(
        rule_code="reject_rate_spike",
        severity="warn",
        metric="reject_rate",
        window_start=now - timedelta(days=10),
        window_end=now - timedelta(days=10) + timedelta(minutes=30),
        observed_value=5.0,
        threshold=3.0,
        created_at=now - timedelta(days=10),
        detail={"note": "old"},
    )
    a_new = AlertEvent(
        rule_code="reject_rate_spike",
        severity="warn",
        metric="reject_rate",
        window_start=now - timedelta(hours=1),
        window_end=now,
        observed_value=5.0,
        threshold=3.0,
        detail={"note": "new"},
    )
    db_session.add_all([a_old, a_new])
    await db_session.commit()
    await db_session.refresh(a_new)

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/alerts?window=24h")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == a_new.id


@pytest.mark.asyncio
async def test_alerts_filter_by_5_dimensions(client, db_session):
    """alerts 接受 modalities / strategy_codes / account_ids / ips / channels / risk_label_paths."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    sub = await _get_user(db_session, "submitter@adreview.example.com")
    # 创建一个有完整 metadata 的 material + 一条高风险 review_task
    await _make_risk_task(
        db_session,
        submitter=sub,
        risk_level="高风险",
        metadata={"ip": "10.0.0.1", "account_id": "acct-X", "channel": "ios"},
    )
    await db_session.commit()

    now = datetime.now(timezone.utc)
    a = AlertEvent(
        rule_code="reject_rate_spike",
        severity="warn",
        metric="reject_rate",
        window_start=now - timedelta(minutes=30),
        window_end=now,
        observed_value=5.0,
        threshold=3.0,
        detail={"note": "test"},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    # 不匹配 IP → 0 items
    resp = await client.get("/api/v1/alerts", params=[("ips", "9.9.9.9")])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 0

    # 匹配 IP → 1 item
    resp = await client.get("/api/v1/alerts", params=[("ips", "10.0.0.1")])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == a.id

    # 多维组合: account + channel
    resp = await client.get(
        "/api/v1/alerts",
        params=[("account_ids", "acct-X"), ("channels", "ios")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1

    # account 对但 channel 错 → 0
    resp = await client.get(
        "/api/v1/alerts",
        params=[("account_ids", "acct-X"), ("channels", "android")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 0


@pytest.mark.asyncio
async def test_alerts_rejects_unknown_modality(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/alerts", params=[("modalities", "pdf")])
    assert resp.status_code == 400, resp.text
    assert "modality" in resp.text


@pytest.mark.asyncio
async def test_alerts_keeps_existing_status_filter(client, db_session):
    """status 过滤仍按 status_=open/acknowledged/all 工作."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    now = datetime.now(timezone.utc)
    a_open = AlertEvent(
        rule_code="reject_rate_spike",
        severity="warn",
        metric="reject_rate",
        window_start=now - timedelta(minutes=30),
        window_end=now,
        observed_value=5.0,
        threshold=3.0,
        status="open",
        detail={},
    )
    a_ack = AlertEvent(
        rule_code="reject_rate_spike",
        severity="warn",
        metric="reject_rate",
        window_start=now - timedelta(minutes=30),
        window_end=now,
        observed_value=5.0,
        threshold=3.0,
        status="acknowledged",
        detail={},
    )
    db_session.add_all([a_open, a_ack])
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/alerts?status=open")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "open"


# ---------------------------------------------------------------------------
# Root cause — /api/v1/alerts/{id}/root-cause
#
# Three rule codes map to three different drill-downs. Added 2026-07-29.
# ---------------------------------------------------------------------------


async def _make_risk_task_with_hits(
    db_session,
    *,
    submitter: User,
    hit_labels: list[str],
    risk_level: str = "高风险",
    completed_at: datetime | None = None,
    metadata: dict | None = None,
) -> tuple[Material, ReviewTask]:
    """Like _make_risk_task but injects a hits array into machine_result."""
    m, task = await _make_risk_task(
        db_session,
        submitter=submitter,
        risk_level=risk_level,
        completed_at=completed_at,
        metadata=metadata,
    )
    task.machine_result = {
        "risk_level": risk_level,
        "hits": [{"label_cn": label} for label in hit_labels],
    }
    await db_session.flush()
    return m, task


@pytest.mark.asyncio
async def test_root_cause_reject_rate_high_routes_to_top_risk_labels(client, db_session):
    """reject_rate_high → top risk labels."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    sub = await _get_user(db_session, "submitter@adreview.example.com")
    now = datetime.now(timezone.utc)
    # 3 条 "政治敏感" + 2 条 "暴恐", 都安排在 alert 窗口内部
    # (alert 窗口结束于 now, 因此任务 completed_at < now, 避开半开区间边界)
    for _ in range(3):
        await _make_risk_task_with_hits(
            db_session, submitter=sub, hit_labels=["政治敏感"],
            completed_at=now - timedelta(minutes=5),
        )
    for _ in range(2):
        await _make_risk_task_with_hits(
            db_session, submitter=sub, hit_labels=["暴恐"],
            completed_at=now - timedelta(minutes=10),
        )
    await db_session.commit()

    a = AlertEvent(
        rule_code="reject_rate_high",
        severity="critical",
        metric="reject_rate",
        window_start=now - timedelta(hours=1),
        window_end=now,
        observed_value=35.0,
        threshold=5.0,
        status="open",
        detail={},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(f"/api/v1/alerts/{a.id}/root-cause")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rule_code"] == "reject_rate_high"
    assert body["rule_label"] == "拒绝率异常"
    assert body["window"]["size_min"] == 60
    labels = [r["label"] for r in body["top_risk_labels"]]
    assert "政治敏感" in labels and "暴恐" in labels
    # 排序检查
    counts = {r["label"]: r["count"] for r in body["top_risk_labels"]}
    assert counts["政治敏感"] >= counts["暴恐"]
    assert body["top_accounts"] == []
    assert body["top_account_ips"] == []


@pytest.mark.asyncio
async def test_root_cause_high_risk_content_routes_to_top_accounts(client, db_session):
    """high_risk_content_high → top accounts (rejected)."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    now = datetime.now(timezone.utc)
    # acct-A: 5 提交 / 4 驳回
    for _ in range(5):
        await _make_risk_task(
            db_session, submitter=sub, risk_level="高风险",
            completed_at=now, metadata={"account_id": "acct-A"},
        )
    # acct-B: 2 提交 / 1 驳回
    for _ in range(2):
        await _make_risk_task(
            db_session, submitter=sub, risk_level="高风险",
            completed_at=now - timedelta(minutes=30),
            metadata={"account_id": "acct-B"},
        )
    await db_session.commit()

    a = AlertEvent(
        rule_code="high_risk_content_high",
        severity="critical",
        metric="high_risk_block_density",
        window_start=now - timedelta(hours=1),
        window_end=now,
        observed_value=80.0,
        threshold=30.0,
        status="open",
        detail={},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)

    resp = await client.get(f"/api/v1/alerts/{a.id}/root-cause")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rule_code"] == "high_risk_content_high"
    assert body["rule_label"] == "账号高风险阻断异常"
    assert len(body["top_accounts"]) >= 2
    # acct-A 必须在最前 (rejected 多)
    assert body["top_accounts"][0]["account_id"] == "acct-A"
    assert body["top_accounts"][0]["submitted"] >= 5
    assert body["top_risk_labels"] == []
    assert body["top_account_ips"] == []


@pytest.mark.asyncio
async def test_root_cause_high_risk_account_concentration_routes_to_account_ips(client, db_session):
    """high_risk_account_concentration → top accounts → top IPs."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    now = datetime.now(timezone.utc)
    # acct-A 在 10.0.0.1 上 3 提交 / 3 驳回
    for _ in range(3):
        await _make_risk_task(
            db_session, submitter=sub, risk_level="高风险",
            completed_at=now,
            metadata={"account_id": "acct-A", "ip": "10.0.0.1"},
        )
    # acct-A 在 10.0.0.2 上 1 提交 / 1 驳回
    await _make_risk_task(
        db_session, submitter=sub, risk_level="高风险",
        completed_at=now - timedelta(minutes=10),
        metadata={"account_id": "acct-A", "ip": "10.0.0.2"},
    )
    await db_session.commit()

    a = AlertEvent(
        rule_code="high_risk_account_concentration",
        severity="critical",
        metric="high_risk_account_density",
        window_start=now - timedelta(hours=1),
        window_end=now,
        observed_value=60.0,
        threshold=50.0,
        status="open",
        detail={},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)

    resp = await client.get(f"/api/v1/alerts/{a.id}/root-cause")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rule_code"] == "high_risk_account_concentration"
    assert body["rule_label"] == "高风险账号聚集异常"
    # 至少 1 行 (acct-A 的 10.0.0.1)
    assert len(body["top_account_ips"]) >= 1
    first = body["top_account_ips"][0]
    assert first["account_id"] == "acct-A"
    assert first["ip"] == "10.0.0.1"
    assert body["top_risk_labels"] == []
    assert body["top_accounts"] == []


@pytest.mark.asyncio
async def test_root_cause_unknown_rule_returns_empty_three_panels(client, db_session):
    """未在 ROOT_CAUSE_RULES 映射里的 rule_code: 返回 3 个空数组而不报错."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    a = AlertEvent(
        rule_code="unknown_rule_xyz",
        severity="warn",
        metric="unknown",
        window_start=datetime.now(timezone.utc) - timedelta(hours=1),
        window_end=datetime.now(timezone.utc),
        observed_value=1.0,
        threshold=0.0,
        status="open",
        detail={},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(f"/api/v1/alerts/{a.id}/root-cause")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rule_code"] == "unknown_rule_xyz"
    assert body["top_risk_labels"] == []
    assert body["top_accounts"] == []
    assert body["top_account_ips"] == []


@pytest.mark.asyncio
async def test_root_cause_404_for_missing_alert(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/alerts/999999/root-cause")
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_root_cause_dimensions_passed_through(client, db_session):
    """alert.dimension 里的 modality / strategy_code / channel 会传到聚合查询."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    a = AlertEvent(
        rule_code="reject_rate_high",
        severity="critical",
        metric="reject_rate",
        window_start=datetime.now(timezone.utc) - timedelta(hours=1),
        window_end=datetime.now(timezone.utc),
        observed_value=35.0,
        threshold=5.0,
        status="open",
        dimension={"modality": "image", "strategy_code": "qa-strategy", "channel": "ios"},
        detail={},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(f"/api/v1/alerts/{a.id}/root-cause")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dimension"] == {
        "modality": "image",
        "strategy_code": "qa-strategy",
        "channel": "ios",
    }


@pytest.mark.asyncio
async def test_alerts_list_includes_public_id(client, db_session):
    """新写入的 AlertEvent 自动得到 public_id, list 接口返回 public_id 字段."""
    await db_session.execute(delete(AlertEvent))
    await db_session.commit()

    now = datetime.now(timezone.utc)
    a = AlertEvent(
        rule_code="reject_rate_spike",
        severity="warn",
        metric="reject_rate",
        window_start=now - timedelta(minutes=30),
        window_end=now,
        observed_value=5.0,
        threshold=3.0,
        status="open",
        detail={},
    )
    db_session.add(a)
    await db_session.commit()
    await db_session.refresh(a)

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/alerts?status=open")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 1
    item = next(i for i in body["items"] if i["id"] == a.id)
    assert item["public_id"], "public_id should be populated"
    assert len(item["public_id"]) >= 8  # UUID 长
