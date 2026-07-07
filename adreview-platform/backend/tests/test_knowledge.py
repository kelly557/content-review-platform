"""Knowledge base API smoke tests."""
from __future__ import annotations

import pytest

import app.models  # noqa: F401
from app.main import app


EXPECTED_PATHS = (
    "/api/v1/knowledge/documents",
    "/api/v1/knowledge/documents/{doc_id}",
    "/api/v1/knowledge/documents/{doc_id}/extract",
    "/api/v1/knowledge/extractions/{ext_id}",
    "/api/v1/knowledge/extraction-items/{item_id}",
    "/api/v1/knowledge/extraction-points/{point_id}",
    "/api/v1/knowledge/extractions/{ext_id}/import",
)


def test_routes_registered():
    paths = app.openapi()["paths"]
    for p in EXPECTED_PATHS:
        assert p in paths, f"missing route: {p}"


def test_schemas_present():
    schemas = app.openapi()["components"]["schemas"]
    for s in (
        "KnowledgeDocumentSummary",
        "KnowledgeDocumentDetail",
        "KnowledgeExtractionOut",
        "KnowledgeExtractionPointOut",
        "KnowledgeImportRequest",
        "KnowledgeImportResult",
    ):
        assert s in schemas, f"missing schema: {s}"


class _FakeMaaSClient:
    """Duck-typed stand-in for MaaSClient (no inheritance)."""

    def __init__(self) -> None:
        self._model = "gpt-4o"
        self._enabled = True

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def model(self) -> str:
        return self._model

    async def chat_json(self, **_kwargs):
        return {
            "items": [
                {
                    "name_cn": "绝对化用语",
                    "description": "广告法禁止的极限词汇",
                    "aliases": ["极限词", "绝对化承诺"],
                    "points": [
                        {
                            "label_cn": "极限词汇",
                            "description": "最高级/最佳级用语",
                            "judgment_logic": {
                                "type": "keyword_match",
                                "expr": "最佳,顶级,第一",
                                "params": {"case_sensitive": False},
                            },
                            "judgment_rule": "命中任意一个极限词即视为违规",
                            "judgment_basis": "广告法第九条",
                            "risk_level": "高风险",
                            "scope_text": "广告文案",
                        },
                        {
                            "label_cn": "100%承诺",
                            "description": "绝对化承诺用语",
                            "judgment_logic": {
                                "type": "regex",
                                "expr": r"100%|百分之百",
                                "params": {},
                            },
                            "judgment_rule": "出现 100%/百分之百 即视为违规",
                            "judgment_basis": "广告法第九条",
                            "risk_level": "中风险",
                            "scope_text": "广告文案",
                        },
                    ],
                },
            ],
        }


@pytest.mark.asyncio
async def test_upload_extract_and_import(client, monkeypatch, tmp_path):
    """End-to-end: upload a TXT → extract with fake MaaS → import selected items/points."""
    monkeypatch.setattr(
        "app.core.config.settings.storage_root", tmp_path, raising=False
    )
    monkeypatch.setattr(
        "app.services.llm.maas_client.get_maas_client", lambda: _FakeMaaSClient()
    )
    monkeypatch.setattr(
        "app.services.knowledge.get_maas_client", lambda: _FakeMaaSClient()
    )

    login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@adreview.example.com",
            "password": "change-me-in-production-please-admin",
        },
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"

    upload = await client.post(
        "/api/v1/knowledge/documents",
        data={
            "title": "广告法节选",
            "domain": "ads_law",
            "scope": "法律法规",
            "tag_ids": "",
        },
        files={"file": ("law.txt", "advertisement law excerpt sample".encode("utf-8"), "text/plain")},
    )
    assert upload.status_code == 201, upload.text
    doc_id = upload.json()["id"]

    ext = await client.post(f"/api/v1/knowledge/documents/{doc_id}/extract")
    assert ext.status_code == 200, ext.text
    ext_data = ext.json()
    assert ext_data["status"] == "succeeded"
    assert len(ext_data["items"]) == 1
    item = ext_data["items"][0]
    assert item["name_cn"] == "绝对化用语"
    assert len(item["points"]) == 2
    ext_id = ext_data["id"]

    point_ids = [p["id"] for p in item["points"]]
    imp = await client.post(
        f"/api/v1/knowledge/extractions/{ext_id}/import",
        json={
            "item_ids": [item["id"]],
            "point_overrides": {point_ids[0]: True, point_ids[1]: False},
            "enable_imported": True,
        },
    )
    assert imp.status_code == 200, imp.text
    result = imp.json()
    assert result["imported_items"] == 1
    assert result["imported_points"] == 1
    assert result["service_code"].startswith("knowledge_ads_law_")

    imported_item_id = result["item_id_map"][item["id"]]
    imported_point_id = result["point_id_map"][point_ids[0]]

    ext_again = (await client.get(f"/api/v1/knowledge/extractions/{ext_id}")).json()
    item_again = next(i for i in ext_again["items"] if i["id"] == item["id"])
    assert item_again["imported_item_id"] == imported_item_id
    imported_pt = next(p for p in item_again["points"] if p["id"] == point_ids[0])
    assert imported_pt["imported_point_id"] == imported_point_id

    rule_pkg = await client.get(f"/api/v1/packages/{result['service_code']}/items")
    assert rule_pkg.status_code == 200, rule_pkg.text
    rule_items = rule_pkg.json()
    assert any(ri["id"] == imported_item_id for ri in rule_items)

    imp2 = await client.post(
        f"/api/v1/knowledge/extractions/{ext_id}/import",
        json={"item_ids": [item["id"]]},
    )
    assert imp2.status_code == 400
    assert "没有可导入的审核项" in imp2.json()["detail"]


@pytest.mark.asyncio
async def test_document_list_and_delete(client, monkeypatch, tmp_path):
    monkeypatch.setattr(
        "app.core.config.settings.storage_root", tmp_path, raising=False
    )
    login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@adreview.example.com",
            "password": "change-me-in-production-please-admin",
        },
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    upload = await client.post(
        "/api/v1/knowledge/documents",
        data={
            "title": "doc-1",
            "domain": "medical",
            "scope": "行业规范",
            "tag_ids": "",
        },
        files={"file": ("doc1.md", "# industry rule excerpt".encode("utf-8"), "text/markdown")},
    )
    assert upload.status_code == 201, upload.text
    doc_id = upload.json()["id"]

    listing = await client.get("/api/v1/knowledge/documents")
    assert listing.status_code == 200
    assert listing.json()["total"] >= 1

    login2 = await client.post(
        "/api/v1/auth/login",
        json={"email": "mlr@adreview.example.com", "password": "mlr12345"},
    )
    client.headers["Authorization"] = f"Bearer {login2.json()['access_token']}"
    denied = await client.delete(f"/api/v1/knowledge/documents/{doc_id}")
    assert denied.status_code == 403

    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
    ok = await client.delete(f"/api/v1/knowledge/documents/{doc_id}")
    assert ok.status_code == 204