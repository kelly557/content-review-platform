"""Tests for alert rules endpoints."""
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


async def test_list_rules_upserts_defaults(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.get("/api/v1/alerts/rules")
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) >= 3
    codes = {x["rule_code"] for x in items}
    assert "reject_rate_high" in codes


async def test_update_rule(client):
    await _login(client, "admin@adreview.example.com", "admin123")
    # 先确保默认规则存在
    await client.get("/api/v1/alerts/rules")
    r = await client.put(
        "/api/v1/alerts/rules/reject_rate_high",
        json={"enabled": False, "critical": {"operator": ">", "value": 7, "unit": "%"}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enabled"] is False
    assert body["critical"]["value"] == 7


async def test_create_and_delete_rule(client):
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.post(
        "/api/v1/alerts/rules",
        json={
            "rule_code": "custom_rule_1",
            "label": "自定义规则",
            "metric": "自定义指标",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["rule_code"] == "custom_rule_1"

    # duplicate
    r = await client.post(
        "/api/v1/alerts/rules",
        json={"rule_code": "custom_rule_1", "label": "dup", "metric": "m"},
    )
    assert r.status_code == 409

    # delete
    r = await client.delete("/api/v1/alerts/rules/custom_rule_1")
    assert r.status_code == 200


async def test_update_rule_requires_admin(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.put(
        "/api/v1/alerts/rules/reject_rate_high",
        json={"enabled": False},
    )
    assert r.status_code == 403
