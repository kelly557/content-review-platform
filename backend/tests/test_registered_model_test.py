"""Tests for registered model test & access-check endpoints."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def _login(client, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login",
        json={"identifier": email, "password": password},
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


async def test_access_check_rejects_unsupported_modality(client):
    await _login(client, "rootadmin@adreview.example.com", "rootadmin123")
    r = await client.post(
        "/api/v1/registered-models/access-check",
        json={"modality": "audio", "endpoint_url": "http://example.com"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    assert "暂不支持" in (body["message"] or "")


async def test_access_check_requires_endpoint(client):
    await _login(client, "rootadmin@adreview.example.com", "rootadmin123")
    r = await client.post(
        "/api/v1/registered-models/access-check",
        json={"modality": "text", "endpoint_url": ""},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is False


async def test_model_test_404_for_missing_model(client):
    await _login(client, "rootadmin@adreview.example.com", "rootadmin123")
    r = await client.post(
        "/api/v1/registered-models/999999/test",
        json={"modality": "text", "input_text": "x", "audit_points": []},
    )
    assert r.status_code == 404
