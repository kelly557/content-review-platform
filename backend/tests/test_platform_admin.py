"""Tests for platform admin: tenants, api-keys, role permissions."""
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


async def test_tenant_crud_and_api_keys(client):
    await _login(client, "rootadmin@adreview.example.com", "rootadmin123")

    # create tenant
    r = await client.post(
        "/api/v1/admin/tenants",
        json={"code": "acme", "name": "Acme 投放", "contact_email": "ops@acme.example.com"},
    )
    assert r.status_code == 201, r.text
    tenant = r.json()
    assert tenant["code"] == "acme"
    assert tenant["public_id"].startswith("tnt_")
    tenant_id = tenant["id"]

    # duplicate code -> 409
    r = await client.post(
        "/api/v1/admin/tenants",
        json={"code": "acme", "name": "dup"},
    )
    assert r.status_code == 409

    # list
    r = await client.get("/api/v1/admin/tenants")
    assert r.status_code == 200
    assert any(t["id"] == tenant_id for t in r.json())

    # update
    r = await client.patch(
        f"/api/v1/admin/tenants/{tenant_id}",
        json={"name": "Acme 集团"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Acme 集团"

    # create api key
    r = await client.post(
        "/api/v1/admin/api-keys",
        json={"tenant_id": tenant_id, "name": "投放-生产", "scope": "write"},
    )
    assert r.status_code == 201, r.text
    key = r.json()
    assert key["plaintext"].startswith("adr_")
    assert key["key_prefix"] == key["plaintext"][:16]
    assert "plaintext" not in {k for k in key if k == "plaintext"} or key["plaintext"]
    key_id = key["id"]

    # list keys (no plaintext)
    r = await client.get("/api/v1/admin/api-keys", params={"tenant_id": tenant_id})
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert "plaintext" not in items[0]

    # rotate (auto-revokes old key, returns fresh key)
    r = await client.post(f"/api/v1/admin/api-keys/{key_id}/rotate")
    assert r.status_code == 200, r.text
    rotated = r.json()
    assert rotated["plaintext"].startswith("adr_")
    assert rotated["id"] != key_id

    # old key already revoked by rotate -> revoke again is 400
    r = await client.post(f"/api/v1/admin/api-keys/{key_id}/revoke")
    assert r.status_code == 400

    # delete tenant (cascades keys)
    r = await client.delete(f"/api/v1/admin/tenants/{tenant_id}")
    assert r.status_code == 200


async def test_role_permissions_get_put(client):
    await _login(client, "admin@adreview.example.com", "admin123")

    # empty initially
    r = await client.get("/api/v1/roles/admin/permissions")
    assert r.status_code == 200
    assert r.json() == []

    # replace
    r = await client.put(
        "/api/v1/roles/admin/permissions",
        json={
            "items": [
                {"role_key": "admin", "menu_key": "overview", "permissions": ["view"]},
                {"role_key": "admin", "menu_key": "reports", "permissions": ["view", "edit"]},
            ]
        },
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out) == 2
    assert {x["menu_key"] for x in out} == {"overview", "reports"}

    # re-read
    r = await client.get("/api/v1/roles/admin/permissions")
    assert len(r.json()) == 2


async def test_platform_admin_gates_non_platform_user(client):
    # reviewer cannot reach tenants
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.get("/api/v1/admin/tenants")
    assert r.status_code == 403

    # reviewer cannot reach api-keys
    r = await client.get("/api/v1/admin/api-keys")
    assert r.status_code == 403


async def test_business_admin_sees_only_own_tenant(client):
    """业务管理员(归属某租户的 admin)只能看到自己租户, 不能创建/删除租户。"""
    await _login(client, "rootadmin@adreview.example.com", "rootadmin123")
    # 建一个租户
    r = await client.post(
        "/api/v1/admin/tenants",
        json={"code": "biz1", "name": "业务租户1"},
    )
    tenant_id = r.json()["id"]

    # 建一个归属该租户的 admin 用户
    from app.core.security import hash_password  # noqa
    r = await client.post(
        "/api/v1/users",
        json={
            "username": "bizadmin",
            "full_name": "业务管理员",
            "password": "bizadmin123",
            "role": "admin",
            "tenant_id": tenant_id,
        },
    )
    assert r.status_code == 201

    # 以该业务管理员登录
    await _login(client, "bizadmin", "bizadmin123")
    r = await client.get("/api/v1/admin/tenants")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["id"] == tenant_id

    # 业务管理员不能创建租户 (写操作仍需 platform admin)
    r = await client.post(
        "/api/v1/admin/tenants",
        json={"code": "forbidden", "name": "x"},
    )
    assert r.status_code == 403


async def test_me_returns_tenant_id(client):
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 200
    assert "tenant_id" in r.json()
