"""Tests for online review detect endpoint."""
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


async def test_detect_returns_compliant_for_clean_text(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/online-review/detect",
        json={
            "media_type": "text",
            "mode": "single",
            "items": [{"kind": "text", "name": "t", "text": "这是一段普通文案"}],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "conclusion" in body
    assert "log_id" in body
    assert "conclusionType" in body
    assert isinstance(body["data"], list)
    assert len(body["data"]) >= 1
    assert "latency_ms" in body


async def test_detect_requires_auth(client):
    r = await client.post(
        "/api/v1/online-review/detect",
        json={"items": [{"kind": "text", "text": "x"}]},
    )
    assert r.status_code == 401
