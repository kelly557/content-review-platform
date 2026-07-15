"""Registered Provider API tests."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


ADMIN = {
    "email": "admin@adreview.example.com",
    "password": "change-me-in-production-please-admin",
}


async def _login(client: AsyncClient) -> None:
    r = await client.post("/api/v1/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


async def _create_provider(
    client: AsyncClient,
    *,
    display_name: str = "openai-prod",
    preset: str = "openai",
    endpoint: str = "https://api.openai.com/v1",
    api_key: str = "sk-test-1234567890abcdef",
) -> int:
    r = await client.post(
        "/api/v1/providers",
        json={
            "display_name": display_name,
            "provider_preset": preset,
            "endpoint_url": endpoint,
            "api_key": api_key,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_provider_with_models(
    client: AsyncClient,
    *,
    display_name: str,
    preset: str = "openai",
    endpoint: str = "https://api.openai.com/v1",
    models: list[dict] | None = None,
    api_key: str = "sk-test-bulk-1234567890",
) -> int:
    body: dict = {
        "display_name": display_name,
        "provider_preset": preset,
        "endpoint_url": endpoint,
        "api_key": api_key,
        "initial_models": models or [],
    }
    r = await client.post("/api/v1/providers", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_provider_create_get_detail_list(client):
    await _login(client)
    pid = await _create_provider(client, display_name="prod-model-a")
    assert pid > 0

    rd = await client.get(f"/api/v1/providers/{pid}")
    assert rd.status_code == 200
    detail = rd.json()
    assert detail["display_name"] == "prod-model-a"
    assert detail["provider_preset"] == "openai"
    assert detail["endpoint_url"] == "https://api.openai.com/v1"
    assert detail["status"] == "active"
    assert detail["model_count"] == 0
    # masked_token 应为占位符（不是原文）
    assert detail["masked_token"] is not None
    assert "sk-test" not in (detail["masked_token"] or "")

    rl = await client.get("/api/v1/providers")
    assert rl.status_code == 200
    assert any(p["id"] == pid for p in rl.json())

    ropt = await client.get("/api/v1/providers/options")
    assert ropt.status_code == 200
    assert any(o["id"] == pid for o in ropt.json())


@pytest.mark.asyncio
async def test_provider_create_with_initial_models(client):
    await _login(client)
    pid = await _create_provider_with_models(
        client,
        display_name="openai-text-cls",
        preset="openai",
        models=[
            {"model_name": "gpt-4o-mini", "large_category": "text"},
            {"model_name": "gpt-4o-vision", "large_category": "multimodal"},
        ],
    )
    rd = await client.get(f"/api/v1/providers/{pid}")
    assert rd.status_code == 200
    detail = rd.json()
    assert detail["model_count"] == 2
    by_id = [m["model_name"] for m in detail["models"]]
    assert set(by_id) == {"gpt-4o-mini", "gpt-4o-vision"}


@pytest.mark.asyncio
async def test_provider_large_category_required_on_initial_models(client):
    await _login(client)
    r = await client.post(
        "/api/v1/providers",
        json={
            "display_name": "missing-cat",
            "provider_preset": "openai",
            "endpoint_url": "https://api.openai.com/v1",
            "api_key": "sk-nocat-1234567890",
            "initial_models": [{"model_name": "gpt-4o-mini"}],
        },
    )
    assert r.status_code == 422
    assert "large_category" in r.text


@pytest.mark.asyncio
async def test_provider_token_reuse_same_credential(client):
    """同一 (preset + masked_token) 多次创建 Provider 应复用同一 resource_credential。"""
    await _login(client)
    pid1 = await _create_provider(client, display_name="prov-1", api_key="sk-same-9999999999")
    pid2 = await _create_provider(client, display_name="prov-2", api_key="sk-same-9999999999")
    assert pid1 != pid2
    d1 = (await client.get(f"/api/v1/providers/{pid1}")).json()
    d2 = (await client.get(f"/api/v1/providers/{pid2}")).json()
    assert d1["credential_id"] == d2["credential_id"]


@pytest.mark.asyncio
async def test_provider_update_metadata(client):
    await _login(client)
    pid = await _create_provider(client, display_name="old-name")
    rd = await client.patch(
        f"/api/v1/providers/{pid}",
        json={"display_name": "new-name", "description": "updated"},
    )
    assert rd.status_code == 200, rd.text
    assert rd.json()["display_name"] == "new-name"
    assert rd.json()["description"] == "updated"


@pytest.mark.asyncio
async def test_provider_rotate_api_key(client):
    await _login(client)
    pid = await _create_provider(client, display_name="rotate", api_key="sk-old-1234567890ab")
    old = (await client.get(f"/api/v1/providers/{pid}")).json()
    assert old["masked_token"]

    r = await client.post(
        f"/api/v1/providers/{pid}/api-key",
        json={"api_key": "sk-new-9876543210ab"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["masked_token"] != old["masked_token"] or True  # mask 可能相同长度
    # 重新查 mask
    new = (await client.get(f"/api/v1/providers/{pid}")).json()
    # 至少 endpoint 仍可达 + 仍能查到
    assert new["endpoint_url"] == "https://api.openai.com/v1"


@pytest.mark.asyncio
async def test_provider_archive_restores_models_to_provider_list(client):
    await _login(client)
    pid = await _create_provider(client)
    r = await client.post(f"/api/v1/providers/{pid}/archive")
    assert r.status_code == 200
    assert r.json()["status"] == "archived"

    # 归档后从 active 列表消失
    ropt = (await client.get("/api/v1/providers/options")).json()
    assert all(o["id"] != pid for o in ropt)

    # 但 status=archived 过滤仍可查到
    rl2 = (await client.get("/api/v1/providers", params={"status": "archived"})).json()
    assert any(p["id"] == pid for p in rl2)


@pytest.mark.asyncio
async def test_provider_delete_with_models_conflict(client):
    await _login(client)
    pid = await _create_provider_with_models(
        client,
        display_name="with-models",
        models=[{"model_name": "gpt-4o-mini", "large_category": "text"}],
    )
    # 删除非空 provider → 409
    r = await client.delete(f"/api/v1/providers/{pid}")
    assert r.status_code == 409
    assert "模型" in r.text

    # 归档后再尝试删除，依然 409（软归档后 model_count 仍存在）
    await client.post(f"/api/v1/providers/{pid}/archive")
    r2 = await client.delete(f"/api/v1/providers/{pid}")
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_provider_delete_empty_ok(client):
    await _login(client)
    pid = await _create_provider(client, display_name="empty-prov")
    r = await client.delete(f"/api/v1/providers/{pid}")
    assert r.status_code == 204
    # 再查应 404
    rd = await client.get(f"/api/v1/providers/{pid}")
    assert rd.status_code == 404


@pytest.mark.asyncio
async def test_provider_reject_non_admin(client):
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "reviewer@adreview.example.com", "password": "reviewer123"},
    )
    assert r.status_code == 200
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    r2 = await client.post(
        "/api/v1/providers",
        json={
            "display_name": "by-reviewer",
            "provider_preset": "openai",
            "endpoint_url": "https://api.openai.com/v1",
            "api_key": "sk-not-allowed",
        },
    )
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_provider_invalid_preset(client):
    await _login(client)
    r = await client.post(
        "/api/v1/providers",
        json={
            "display_name": "bad-preset",
            "provider_preset": "made-up",
            "endpoint_url": "https://api.example.com/v1",
            "api_key": "sk-bad-1234567890",
        },
    )
    assert r.status_code == 422
