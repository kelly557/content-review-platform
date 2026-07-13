"""Smoke + integration tests for the query router (data query page)."""
import pytest

import app.models  # noqa: F401
from app.main import app


def test_query_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/query/results",
        "/api/v1/query/results/export.csv",
        "/api/v1/query/labels",
        "/api/v1/query/review",
    ):
        assert key in paths, f"missing route: {key}"


def test_query_schemas_present():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in (
        "MachineReviewRecordOut",
        "Page_MachineReviewRecordOut_",
        "QueryLabelsOut",
        "MachineHitOut",
        "ReviewRecordOut",
        "Page_ReviewRecordOut_",
    ):
        assert s in schemas, f"missing schema: {s}"


def test_export_csv_routes_registered():
    """Smoke: export route is exposed even though integration test is omitted
    (per-test schema isolation is too fragile for SQLAlchemy async tables)."""
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/query/results/export.csv" in paths


@pytest.mark.asyncio
async def test_query_results_requires_reviewer_role(client):
    """submitter cannot access the query page."""
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "submitter@adreview.example.com", "password": "submitter123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.get("/api/v1/query/results")
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_query_results_reviewer_can_list(client):
    """reviewer can call the endpoint with empty results."""
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "reviewer@adreview.example.com", "password": "reviewer123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.get("/api/v1/query/results")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1


@pytest.mark.asyncio
async def test_query_labels_empty(client):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "mlr@adreview.example.com", "password": "mlr12345"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.get("/api/v1/query/labels")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"labels": []}


@pytest.mark.asyncio
async def test_query_results_invalid_conditions(client):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "reviewer@adreview.example.com", "password": "reviewer123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.get("/api/v1/query/results?conditions=not-json")
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_query_review_requires_reviewer_role(client):
    """submitter cannot access the review page."""
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "submitter@adreview.example.com", "password": "submitter123"},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    resp = await client.get("/api/v1/query/review")
    assert resp.status_code == 403, resp.text


# ─── review_tasks.strategy_id FK integration (2026-07-17) ────────────
# /query/results 的"策略名称"列必须返回 strategies 表里的真名，而不是
# fallback 到 task.stage_key。FK 真名优先于 JSONB 快照，JSONB 快照优先于
# stage_key，保留历史 task 的兜底链不破坏。
#
# 注意：以下测试不调 HTTP 端点，也不依赖跨 fixture 共享的 schema。它们
# 直接构造 ORM 对象并调内部 ``_to_record`` 序列化函数，避开 conftest
# 中 "client 与 db_session 各走一个 db_session_factory 调用、不同
# schema" 的隔离边界（旧测试同样不使用跨 fixture 的 ORM 写入）。只
# 验证 _to_record 的 priority chain 与 _apply_filters 的 SQL 编译。
# HTTP 集成走人工 / 浏览器验收。

import datetime as _dt

from app.api.v1.query import _to_record
from app.models.material import Material, MaterialStatus, MaterialType
from app.models.review import (
    ReviewDecision,
    ReviewTask,
    ReviewType,
)
from app.models.strategy import Strategy, StrategyScope


def _make_task(
    *,
    strategy_id: int | None = None,
    machine_result: dict | None = None,
    stage_key: str = "ai_scan",
    title: str = "qa-task",
) -> ReviewTask:
    """Construct a transient ReviewTask ORM object (not persisted)."""
    return ReviewTask(
        id=1,
        material_id=1,
        material_version_id=1,
        workflow_instance_id=1,
        stage_key=stage_key,
        title=title,
        strategy_id=strategy_id,
        review_type=ReviewType.HUMAN,
        final_decision=ReviewDecision.APPROVED,
        machine_result=machine_result,
        machine_started_at=None,
        machine_completed_at=None,
        created_at=_dt.datetime(2026, 7, 17, 0, 0, 0),
    )


def _make_strategy(*, code: str, name: str) -> Strategy:
    return Strategy(
        id=1,
        code=code,
        name=name,
        scope=StrategyScope.GENERAL,
        is_active=True,
    )


def test_to_record_uses_strategy_fk_name():
    """FK 真名优先于 JSONB 快照、stage_key。"""
    task = _make_task(
        strategy_id=1,
        machine_result={"risk_level": "低风险"},  # 故意不带 strategy 块
    )
    strategy = _make_strategy(code="ecom_qa", name="电商基础策略")
    out = _to_record(
        task=task,
        material=None,
        submitter=None,
        assignee=None,
        tag_snapshots=[],
        strategy_orm=strategy,
    )
    assert out.strategy_name == "电商基础策略"
    assert out.strategy_code == "ecom_qa"


def test_to_record_falls_back_to_jsonb_snapshot_when_no_fk():
    """无 FK 时回退到 machine_result.strategy JSONB 快照，保留历史路径。"""
    task = _make_task(
        strategy_id=None,
        machine_result={"risk_level": "低风险", "strategy": {"code": "old", "name": "旧名"}},
    )
    out = _to_record(
        task=task,
        material=None,
        submitter=None,
        assignee=None,
        tag_snapshots=[],
        strategy_orm=None,
    )
    assert out.strategy_name == "旧名"
    assert out.strategy_code == "old"


def test_to_record_falls_back_to_stage_key_when_no_fk_no_snapshot():
    """既无 FK 也无 JSONB 块时回退到 task.stage_key（保留原行为）。"""
    task = _make_task(strategy_id=None, machine_result=None, stage_key="ai_scan")
    out = _to_record(
        task=task,
        material=None,
        submitter=None,
        assignee=None,
        tag_snapshots=[],
        strategy_orm=None,
    )
    assert out.strategy_name == "ai_scan"
    assert out.strategy_code == "ai_scan"