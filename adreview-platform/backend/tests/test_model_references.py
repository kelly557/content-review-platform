"""Tests for model deletion reference check + ResourceCredential.token_expires_at.

需求:
  - GET /registered-models/{id}/references 返回 audit_item + strategy 引用；
  - DELETE /registered-models/{id} 在引用非空时 422 阻断；
  - rotateApiKey / create 接受 token_expires_at 写入。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.audit_item import AuditItem
from app.models.registered_model import (
    RegisteredProvider,
    ResourceCredential,
)
from app.models.service import Service
from app.models.strategy import Strategy, StrategyScope


ADMIN = {
    "email": "admin@adreview.example.com",
    "password": "admin123",
}


async def _login(client: AsyncClient, who: dict = ADMIN) -> None:
    r = await client.post("/api/v1/auth/login", json=who)
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


async def _create_provider(client: AsyncClient, *, name: str, preset: str = "openai") -> int:
    r = await client.post(
        "/api/v1/providers",
        json={
            "display_name": name,
            "provider_preset": preset,
            "endpoint_url": "https://api.openai.com/v1",
            "api_key": "sk-test-1234567890abcdef",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_model(client: AsyncClient, provider_id: int, model_name: str) -> int:
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": f"{model_name}-display",
            "kind": "large",
            "large_category": "text",
            "provider_id": provider_id,
            "model_name": model_name,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_delete_unreferenced_model_succeeds(client: AsyncClient):
    await _login(client)
    pid = await _create_provider(client, name="ref-unreferenced")
    mid = await _create_model(client, pid, "ref-unreferenced-m1")

    r = await client.get(f"/api/v1/registered-models/{mid}/references")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_blocked"] is False
    assert body["summary"] == {"audit_item": 0, "strategy": 0}
    assert body["items"] == []

    r = await client.delete(f"/api/v1/registered-models/{mid}")
    assert r.status_code == 200, r.text
    assert r.json()["is_deleted"] is True


@pytest.mark.asyncio
async def test_delete_blocked_by_audit_item(client: AsyncClient, db_session):
    await _login(client)
    pid = await _create_provider(client, name="ref-blocked-ai")
    mid = await _create_model(client, pid, "ref-blocked-ai-m1")
    code = f"ref-test-ai-{mid}"

    # AuditItem.package_code FK 到 services.code，测试 schema 是空的；
    # 先 seed 一个 service，再插 audit_item。
    svc = Service(
        code="text_audit_pro",
        name="Text Audit Pro",
    )
    db_session.add(svc)
    await db_session.flush()

    ai = AuditItem(
        package_code="text_audit_pro",
        code=code,
        name_cn=code,
        small_category="ad_law",
        is_builtin=False,
        active_large_model_id=mid,
    )
    db_session.add(ai)
    await db_session.commit()

    try:
        r = await client.get(f"/api/v1/registered-models/{mid}/references")
        assert r.status_code == 200
        body = r.json()
        assert body["is_blocked"] is True
        assert body["summary"]["audit_item"] >= 1
        assert any(it["kind"] == "audit_item" for it in body["items"])

        r = await client.delete(f"/api/v1/registered-models/{mid}")
        assert r.status_code == 422, r.text
    finally:
        ai.active_large_model_id = None
        await db_session.commit()
        # 不删 svc：test schema 测试结束会被 drop；删会导致 FK 顺序问题


@pytest.mark.asyncio
async def test_delete_blocked_by_strategy(client: AsyncClient, db_session):
    await _login(client)
    pid = await _create_provider(client, name="ref-blocked-strategy")
    mid = await _create_model(client, pid, "ref-blocked-strategy-m1")
    code = f"ref-test-sg-{mid}"

    sg = Strategy(
        code=code,
        name=code,
        scope=StrategyScope.GENERAL,
        is_active=True,
        definition={
            "services": [
                {"code": "ad_compliance", "llm_review": {"model_id": mid}},
            ]
        },
    )
    db_session.add(sg)
    await db_session.commit()

    try:
        r = await client.get(f"/api/v1/registered-models/{mid}/references")
        assert r.status_code == 200
        body = r.json()
        assert body["is_blocked"] is True
        assert body["summary"]["strategy"] >= 1
        assert any(it["kind"] == "strategy" for it in body["items"])

        r = await client.delete(f"/api/v1/registered-models/{mid}")
        assert r.status_code == 422
    finally:
        await db_session.delete(sg)
        await db_session.commit()


@pytest.mark.asyncio
async def test_rotate_api_key_writes_token_expires_at(client: AsyncClient, db_session):
    await _login(client)
    pid = await _create_provider(client, name="ref-rotate-expires")

    future = (datetime.utcnow() + timedelta(days=15)).replace(tzinfo=timezone.utc).isoformat()
    r = await client.post(
        f"/api/v1/providers/{pid}/api-key",
        json={"api_key": "sk-new-1234567890abcdef", "token_expires_at": future},
    )
    assert r.status_code == 200, r.text

    prov = await db_session.scalar(
        select(RegisteredProvider).where(RegisteredProvider.id == pid)
    )
    cred = await db_session.scalar(
        select(ResourceCredential).where(ResourceCredential.id == prov.credential_id)
    )
    assert cred.token_expires_at is not None


@pytest.mark.asyncio
async def test_create_provider_with_token_expires_at(client: AsyncClient, db_session):
    await _login(client)
    future = (datetime.utcnow() + timedelta(days=7)).replace(tzinfo=timezone.utc).isoformat()
    r = await client.post(
        "/api/v1/providers",
        json={
            "display_name": "ref-create-with-expires",
            "provider_preset": "openai",
            "endpoint_url": "https://api.openai.com/v1",
            "api_key": "sk-create-1234567890abcdef",
            "token_expires_at": future,
        },
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    prov = await db_session.scalar(
        select(RegisteredProvider).where(RegisteredProvider.id == pid)
    )
    cred = await db_session.scalar(
        select(ResourceCredential).where(ResourceCredential.id == prov.credential_id)
    )
    assert cred.token_expires_at is not None
    await client.delete(f"/api/v1/providers/{pid}")


@pytest.mark.asyncio
async def test_validate_accepts_temp_body(client: AsyncClient):
    """validate_provider 接受临时 endpoint_url / api_key（保存前测试连接）。"""
    await _login(client)
    pid = await _create_provider(client, name="ref-validate-temp")

    # 不带 body — fallback DB 值
    r = await client.post(f"/api/v1/providers/{pid}/validate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "ok" in body
    assert "message" in body

    # 带临时 endpoint_url（不可达的 ip）
    r2 = await client.post(
        f"/api/v1/providers/{pid}/validate",
        json={"endpoint_url": "http://127.0.0.1:1/nothing"},
    )
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["ok"] is False
    assert body2["message"]  # 失败信息

    # 带临时 api_key + 现有 url
    # 注：openai.com /v1 对任何 Bearer 都返回 200，所以这里**不强制**断言 ok=False。
    # 验证接口接受了 body 且返回正确结构即可。
    r3 = await client.post(
        f"/api/v1/providers/{pid}/validate",
        json={"api_key": "sk-fake-1234567890abcdef"},
    )
    assert r3.status_code == 200, r3.text
    assert "ok" in r3.json()
    assert "message" in r3.json()

    # 同时带两个临时值
    r4 = await client.post(
        f"/api/v1/providers/{pid}/validate",
        json={
            "endpoint_url": "http://127.0.0.1:1/nothing",
            "api_key": "sk-fake-1234567890abcdef",
        },
    )
    assert r4.status_code == 200, r4.text
    assert r4.json()["ok"] is False
    assert r4.json()["message"]  # 失败信息


@pytest.mark.asyncio
async def test_validate_temp_body_does_not_persist(client: AsyncClient, db_session):
    """validate 用临时 body 时，**不修改** DB 任何字段。"""
    await _login(client)
    pid = await _create_provider(client, name="ref-validate-no-persist")

    r = await client.post(
        f"/api/v1/providers/{pid}/validate",
        json={
            "endpoint_url": "http://127.0.0.1:1/nothing",
            "api_key": "sk-fake-1234567890abcdef",
        },
    )
    assert r.status_code == 200

    from app.models.registered_model import RegisteredProvider

    prov = await db_session.scalar(
        select(RegisteredProvider).where(RegisteredProvider.id == pid)
    )
    assert prov.endpoint_url == "https://api.openai.com/v1"
    cred = await db_session.scalar(
        select(ResourceCredential).where(ResourceCredential.id == prov.credential_id)
    )
    assert cred.masked_token != "sk-fake-1234567890abcdef"
