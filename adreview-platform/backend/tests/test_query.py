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