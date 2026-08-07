"""Tests for review agents router."""
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


async def test_agent_crud_publish_unpublish(client):
    await _login(client, "admin@adreview.example.com", "admin123")

    # create
    r = await client.post(
        "/api/v1/review-agents",
        json={
            "app_id": "txt_agent_01",
            "name": "文本审核智能体",
            "modality": "文本",
            "points": [{"id": "p1", "label": "医药", "desc": "OTC"}],
        },
    )
    assert r.status_code == 201, r.text
    a = r.json()
    aid = a["id"]
    assert a["status"] == "未发布"

    # duplicate app_id
    r = await client.post(
        "/api/v1/review-agents",
        json={"app_id": "txt_agent_01", "name": "dup", "modality": "文本"},
    )
    assert r.status_code == 409

    # list
    r = await client.get("/api/v1/review-agents")
    assert any(x["id"] == aid for x in r.json())

    # update
    r = await client.put(f"/api/v1/review-agents/{aid}", json={"name": "改名"})
    assert r.status_code == 200
    assert r.json()["name"] == "改名"

    # publish
    r = await client.post(
        f"/api/v1/review-agents/{aid}/publish",
        json={"modality": "文本", "name": "改名", "points": [{"id": "p1", "label": "医药"}]},
    )
    assert r.status_code == 200, r.text
    ver = r.json()
    assert ver["is_current"] is True
    assert ver["version"] == "v1"

    # agent status updated
    r = await client.get(f"/api/v1/review-agents/{aid}")
    assert r.json()["status"] == "已发布"

    # versions list
    r = await client.get(f"/api/v1/review-agents/{aid}/versions")
    assert len(r.json()) == 1

    # unpublish
    r = await client.post(f"/api/v1/review-agents/{aid}/unpublish")
    assert r.status_code == 200
    r = await client.get(f"/api/v1/review-agents/{aid}")
    assert r.json()["status"] == "已下线"

    # delete
    r = await client.delete(f"/api/v1/review-agents/{aid}")
    assert r.status_code == 200


async def test_agent_test_requires_existing(client):
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.post(
        "/api/v1/review-agents/999999/test",
        json={"modality": "文本", "text": "x", "mode": "single", "points": []},
    )
    assert r.status_code == 404


async def test_agent_ai_optimize_returns_structure(client):
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.post(
        "/api/v1/review-agents/ai-optimize",
        json={"direction": "信贷营销利率承诺检测"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "finalTag" in body
    assert "direction" in body
