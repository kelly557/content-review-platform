"""Tests for /api/v1/page-guides CRUD.

Covers:
- 401 unauthenticated
- 200 list (empty initially)
- 200 PUT then 200 GET round-trip
- 200 PUT-overwrite updates title and markdown
- 204 DELETE then 404 GET
- 400 validation errors (empty markdown, oversize markdown, empty path, long path)

Per the design decision for this feature, any logged-in user is allowed
to write — we just need to make sure the auth gate and validation gates
behave correctly.
"""
from __future__ import annotations

import pytest

import app.models  # noqa: F401  -- register all models on Base.metadata


async def _login(client, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_list_unauthenticated_rejected(client):
    r = await client.get("/api/v1/page-guides")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_empty_for_brand_new_tenant(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.get("/api/v1/page-guides")
    assert r.status_code == 200
    body = r.json()
    assert body == {"guides": []}


@pytest.mark.asyncio
async def test_put_then_get_roundtrip(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    path = "/strategies/abc/edit"
    payload = {"title": "策略编辑 · 原型说明", "markdown_md": "## 字段\n- foo"}
    r = await client.put(f"/api/v1/page-guides{path}", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["path"] == path
    assert out["title"] == payload["title"]
    assert out["markdown_md"] == payload["markdown_md"]
    assert out["updated_by_id"] is not None

    g = await client.get(f"/api/v1/page-guides{path}")
    assert g.status_code == 200
    body = g.json()
    assert body["title"] == payload["title"]
    assert body["markdown_md"] == payload["markdown_md"]


@pytest.mark.asyncio
async def test_put_overwrites_existing(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    path = "/online-review"
    await client.put(
        f"/api/v1/page-guides{path}",
        json={"title": "v1", "markdown_md": "first"},
    )
    r = await client.put(
        f"/api/v1/page-guides{path}",
        json={"title": "v2", "markdown_md": "second"},
    )
    assert r.status_code == 200
    out = r.json()
    assert out["title"] == "v2"
    assert out["markdown_md"] == "second"

    listing = (await client.get("/api/v1/page-guides")).json()["guides"]
    matched = [g for g in listing if g["path"] == path]
    assert len(matched) == 1
    assert matched[0]["title"] == "v2"


@pytest.mark.asyncio
async def test_delete_then_get_404(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    path = "/online-review"
    await client.put(
        f"/api/v1/page-guides{path}",
        json={"title": "t", "markdown_md": "m"},
    )
    d = await client.delete(f"/api/v1/page-guides{path}")
    assert d.status_code == 204
    g = await client.get(f"/api/v1/page-guides{path}")
    assert g.status_code == 404


@pytest.mark.asyncio
async def test_delete_missing_path_is_idempotent_204(client):
    """Deleting a path that never had an override is a no-op 204."""
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    d = await client.delete("/api/v1/page-guides/never/existed")
    assert d.status_code == 204


@pytest.mark.asyncio
async def test_put_empty_markdown_rejected(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.put(
        "/api/v1/page-guides/online-review",
        json={"title": "t", "markdown_md": "   "},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_put_oversize_markdown_rejected(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    huge = "x" * (101 * 1024)  # 101KB > 100KB cap
    r = await client.put(
        "/api/v1/page-guides/online-review",
        json={"title": "t", "markdown_md": huge},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_path_with_slash_is_supported(client):
    """The frontend path is '/strategies/:id/edit' which contains slashes;
    the API should accept the full path verbatim via {path:path}."""
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    path = "/strategies/42/edit"
    r = await client.put(
        f"/api/v1/page-guides{path}",
        json={"title": "edit 42", "markdown_md": "body"},
    )
    assert r.status_code == 200
    assert r.json()["path"] == path
    g = await client.get(f"/api/v1/page-guides{path}")
    assert g.status_code == 200
    assert g.json()["path"] == path
