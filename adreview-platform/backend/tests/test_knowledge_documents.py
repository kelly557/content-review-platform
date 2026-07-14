"""Knowledge document API tests."""
from __future__ import annotations

import io

import pytest
from httpx import ASGITransport, AsyncClient


ADMIN_PAYLOAD = {
    "email": "admin@adreview.example.com",
    "password": "change-me-in-production-please-admin",
}


async def _login(client: AsyncClient) -> None:
    r = await client.post("/api/v1/auth/login", json=ADMIN_PAYLOAD)
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_knowledge_documents_create_upload_list_download(client):
    await _login(client)
    files = {"file": ("guide.pdf", io.BytesIO(b"%PDF-1.4 stub"), "application/pdf")}
    data = {
        "title": "广宣品审核手册 v1",
        "description": "面向审核员的业务知识库",
        "tags": "广宣品,广告法,合规",
    }
    r = await client.post("/api/v1/knowledge-documents/uploads", files=files, data=data)
    assert r.status_code == 201, r.text
    body = r.json()
    doc_id = body["id"]
    assert body["title"] == "广宣品审核手册 v1"
    assert body["source_type"] == "upload"
    assert body["tags"] == ["广宣品", "广告法", "合规"]

    r2 = await client.get("/api/v1/knowledge-documents", params={"q": "广宣品"})
    assert r2.status_code == 200
    assert any(d["id"] == doc_id for d in r2.json()["items"])

    r3 = await client.get(f"/api/v1/knowledge-documents/{doc_id}")
    assert r3.status_code == 200
    assert r3.json()["current_version"] is not None
    assert r3.json()["current_version"]["version_no"] == 1

    files2 = {"file": ("guide-v2.pdf", io.BytesIO(b"%PDF-1.4 v2"), "application/pdf")}
    r4 = await client.post(f"/api/v1/knowledge-documents/{doc_id}/versions", files=files2)
    assert r4.status_code == 201
    assert r4.json()["version_no"] == 2

    r5 = await client.get(f"/api/v1/knowledge-documents/{doc_id}/download")
    assert r5.status_code == 200


@pytest.mark.asyncio
async def test_knowledge_documents_register_url(client):
    await _login(client)
    body = {
        "title": "广告法实施指南",
        "tags": ["广告法", "合规"],
        "source_type": "url",
        "source_url": "https://example.gov.cn/policy",
        "status": "draft",
    }
    r = await client.post("/api/v1/knowledge-documents/register-url", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["source_type"] == "url"
    assert r.json()["current_version"] is not None
    r2 = await client.get(
        f"/api/v1/knowledge-documents/{r.json()['id']}/download",
        follow_redirects=False,
    )
    assert r2.status_code in (302, 307)


@pytest.mark.asyncio
async def test_knowledge_documents_register_url_requires_source_url(client):
    await _login(client)
    r = await client.post(
        "/api/v1/knowledge-documents",
        json={"title": "no url", "source_type": "url"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_knowledge_documents_soft_delete(client):
    await _login(client)
    body = {
        "title": "内部 SOP",
        "tags": ["审核流程"],
        "source_type": "manual",
    }
    r = await client.post("/api/v1/knowledge-documents", json=body)
    assert r.status_code == 201
    doc_id = r.json()["id"]
    rd = await client.delete(f"/api/v1/knowledge-documents/{doc_id}")
    assert rd.status_code == 200
    g = await client.get(f"/api/v1/knowledge-documents/{doc_id}")
    assert g.status_code == 404


@pytest.mark.asyncio
async def test_knowledge_documents_rejects_bad_mime(client):
    await _login(client)
    r = await client.post(
        "/api/v1/knowledge-documents/uploads",
        data={"title": "x"},
        files={"file": ("bad.exe", io.BytesIO(b"x"), "application/octet-stream")},
    )
    assert r.status_code in (415, 422)


@pytest.mark.asyncio
async def test_knowledge_documents_list_filters(client):
    await _login(client)
    await client.post(
        "/api/v1/knowledge-documents",
        json={
            "title": "draft doc",
            "tags": ["draft"],
            "source_type": "manual",
            "status": "draft",
        },
    )
    await client.post(
        "/api/v1/knowledge-documents",
        json={
            "title": "active doc",
            "tags": ["active"],
            "source_type": "manual",
            "status": "active",
        },
    )
    r = await client.get("/api/v1/knowledge-documents", params={"status": "active"})
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["status"] == "active"

    r2 = await client.get("/api/v1/knowledge-documents", params={"tag": "draft"})
    assert r2.status_code == 200
    for item in r2.json()["items"]:
        assert "draft" in item["tags"]


@pytest.mark.asyncio
async def test_knowledge_documents_reject_non_admin_write(client):
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "mlr@adreview.example.com", "password": "mlr12345"},
    )
    assert r.status_code == 200
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    body = {"title": "x", "tags": [], "source_type": "manual"}
    r2 = await client.post("/api/v1/knowledge-documents", json=body)
    assert r2.status_code == 403
    r3 = await client.get("/api/v1/knowledge-documents")
    assert r3.status_code == 200
