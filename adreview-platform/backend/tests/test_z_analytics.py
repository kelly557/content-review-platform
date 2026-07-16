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
        json={"email": "submitter@adreview.example.com", "password": "submitter123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.get("/api/v1/reports/overview")
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_alerts_ack_requires_mlr(client):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "reviewer@adreview.example.com", "password": "reviewer123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.post("/api/v1/alerts/1/ack", json={})
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Empty-DB happy paths
# ---------------------------------------------------------------------------


async def _login(client, email: str, password: str) -> None:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
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
) -> tuple[Material, ReviewTask]:
    """Create a Material + WorkflowInstance + a completed ReviewTask with machine_result.risk_level."""
    m = Material(
        title=f"risk {datetime.utcnow().timestamp()}-{id(object())}",
        material_type=material_type,
        status=MaterialStatus.APPROVED if risk_level in {"低风险", "无风险"} else MaterialStatus.REJECTED,
        submitter_id=submitter.id,
    )
    db_session.add(m)
    await db_session.flush()
    v = MaterialVersion(
        material_id=m.id,
        version_no=1,
        storage_key=f"qa/risk/{m.id}/v1.txt",
        original_filename="x.txt",
        mime_type="text/plain",
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

    task = ReviewTask(
        material_id=m.id,
        material_version_id=v.id,
        workflow_instance_id=inst.id,
        stage_key="machine",
        title="risk task",
        review_type=ReviewType.MACHINE,
        machine_status=MachineStatus.COMPLETED,
        machine_result={"risk_level": risk_level} if risk_level else None,
        machine_completed_at=completed_at or datetime.utcnow(),
    )
    db_session.add(task)
    await db_session.flush()
    return m, task


@pytest.mark.asyncio
async def test_risk_trend_empty(client):
    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk/trend?days=7")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["days"] == 7
    assert len(body["points"]) == 7
    for p in body["points"]:
        assert p["total"] == 0
        assert p["high"] == 0
        assert p["medium"] == 0
        assert p["low"] == 0
        assert p["sensitive"] == 0
        assert p["none"] == 0


@pytest.mark.asyncio
async def test_risk_trend_splits_levels(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(db_session, submitter=sub, risk_level="高风险")
    await _make_risk_task(db_session, submitter=sub, risk_level="中风险")
    await _make_risk_task(db_session, submitter=sub, risk_level="低风险")
    await _make_risk_task(db_session, submitter=sub, risk_level="无风险")
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get("/api/v1/reports/risk/trend?days=7")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    totals = {lvl: sum(p[lvl] for p in body["points"]) for lvl in ("high", "medium", "low", "none")}
    assert totals == {"high": 1, "medium": 1, "low": 1, "none": 1}


@pytest.mark.asyncio
async def test_risk_trend_filter_by_material_type(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    # 2 text (高风险) — should be counted
    await _make_risk_task(db_session, submitter=sub, material_type=MaterialType.TEXT, risk_level="高风险")
    await _make_risk_task(db_session, submitter=sub, material_type=MaterialType.TEXT, risk_level="高风险")
    # 1 image (中风险) — should be filtered out
    await _make_risk_task(
        db_session, submitter=sub, material_type=MaterialType.IMAGE, risk_level="中风险"
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params={"days": 7, "material_types": "text"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    medium_total = sum(p["medium"] for p in body["points"])
    assert high_total == 2
    assert medium_total == 0


@pytest.mark.asyncio
async def test_risk_trend_filter_accepts_multiple_types(client, db_session):
    sub = await _get_user(db_session, "submitter@adreview.example.com")
    await _make_risk_task(db_session, submitter=sub, material_type=MaterialType.TEXT, risk_level="高风险")
    await _make_risk_task(
        db_session, submitter=sub, material_type=MaterialType.IMAGE, risk_level="高风险"
    )
    # pdf excluded
    await _make_risk_task(
        db_session, submitter=sub, material_type=MaterialType.PDF, risk_level="高风险"
    )
    await db_session.commit()

    await _login(client, "mlr@adreview.example.com", "mlr12345")
    resp = await client.get(
        "/api/v1/reports/risk/trend",
        params=[("days", 7), ("material_types", "text"), ("material_types", "image")],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    high_total = sum(p["high"] for p in body["points"])
    assert high_total == 2
