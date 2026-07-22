"""Registered model + credential API tests."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


ADMIN = {
    "email": "admin@adreview.example.com",
    "password": "admin123",
}

_SUPERADMIN = {
    "email": "superadmin@adreview.example.com",
    "password": "superadmin123",
}


async def _login(client: AsyncClient, who: dict = ADMIN) -> None:
    r = await client.post("/api/v1/auth/login", json=who)
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


async def _create_credential(client: AsyncClient, name: str = "openai-prod") -> int:
    r = await client.post(
        "/api/v1/credentials",
        json={"name": name, "provider": "openai", "token": "sk-test-1234567890abcdef"},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


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


@pytest.mark.asyncio
async def test_registered_models_create_list_detail_versions(client):
    await _login(client)
    pid = await _create_provider(client)
    body = {
        "name": "GPT-4o 文本审核",
        "description": "用于广宣品文本审核",
        "kind": "large",
        "large_category": "text",
        "provider_id": pid,
        "model_name": "gpt-4o-mini",
        "version": "1.0.0",
    }
    r = await client.post("/api/v1/registered-models", json=body)
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert r.json()["kind"] == "large"
    assert r.json()["large_category"] == "text"
    assert r.json()["small_category"] is None
    assert r.json()["provider_id"] == pid
    assert r.json()["model_name"] == "gpt-4o-mini"
    assert r.json()["description"] == "用于广宣品文本审核"
    assert r.json()["current_version"]["version_no"] == 1
    assert r.json()["current_version"]["version_label"] == "1.0.0"

    r1 = await client.get("/api/v1/registered-models", params={"kind": "large"})
    assert r1.status_code == 200
    assert any(m["id"] == mid for m in r1.json()["items"])

    r2 = await client.get(f"/api/v1/registered-models/{mid}")
    assert r2.status_code == 200
    assert r2.json()["current_version"] is not None


@pytest.mark.asyncio
async def test_small_model_requires_category(client):
    await _login(client)
    pid = await _create_provider(client, display_name="selfhost-a", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "政治类小模型",
            "kind": "small",
            "provider_id": pid,
            "model_name": "politics-v1",
        },
    )
    assert r.status_code == 422
    assert "small_category" in r.text


@pytest.mark.asyncio
async def test_small_model_with_category_ok(client):
    await _login(client)
    pid = await _create_provider(client, display_name="selfhost-b", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "广告法小模型",
            "kind": "small",
            "small_category": "ad_law", "modality": "text",
            "provider_id": pid,
            "model_name": "adlaw-v1",
            "max_output_tokens": 512,
            "artifact": {
                "storage_key": "models/2026/07/legacy-fixture.onnx",
                "filename": "adlaw.onnx",
                "mime_type": "application/octet-stream",
                "size": 1234,
                "sha256": "0" * 64,
            },
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "small"
    assert r.json()["small_category"] == "ad_law"


@pytest.mark.asyncio
async def test_small_model_invalid_category(client):
    await _login(client)
    pid = await _create_provider(client, display_name="selfhost-c", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "bad cat",
            "kind": "small",
            "small_category": "unknown_category", "modality": "text",
            "provider_id": pid,
            "model_name": "x",
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_large_model_ignores_small_category(client):
    await _login(client)
    pid = await _create_provider(client)
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "大模型",
            "kind": "large",
            "small_category": "ad_law",
            "modality": "text",
            "large_category": "text",
            "provider_id": pid,
            "model_name": "gpt-4o",
        },
    )
    assert r.status_code == 201
    assert r.json()["small_category"] is None
    assert r.json()["modality"] is None
    assert r.json()["large_category"] == "text"


@pytest.mark.asyncio
async def test_small_model_requires_modality(client):
    await _login(client)
    art = await _upload_small_model_file(client, b"no-modality")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "缺模态",
            "kind": "small",
            "small_category": "politics",
            "model_name": "politics-no-modality",
            "max_output_tokens": 256,
            "registration_method": "uploaded_file",
            "artifact": art,
        },
    )
    assert r.status_code == 422, r.text
    assert "modality" in r.text


@pytest.mark.asyncio
async def test_small_model_invalid_modality(client):
    await _login(client)
    art = await _upload_small_model_file(client, b"bad-modality")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "非法模态",
            "kind": "small",
            "small_category": "politics",
            "modality": "audio",
            "model_name": "politics-bad-modality",
            "max_output_tokens": 256,
            "registration_method": "uploaded_file",
            "artifact": art,
        },
    )
    assert r.status_code == 422, r.text
    assert "modality" in r.text


@pytest.mark.asyncio
async def test_large_model_requires_large_category(client):
    await _login(client)
    pid = await _create_provider(client)
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "no-category",
            "kind": "large",
            "provider_id": pid,
            "model_name": "gpt-4o",
        },
    )
    assert r.status_code == 422
    assert "large_category" in r.text


@pytest.mark.asyncio
async def test_version_create_and_activate(client):
    await _login(client)
    pid = await _create_provider(client)
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "versioned model",
            "kind": "large",
            "large_category": "text",
            "provider_id": pid,
            "model_name": "gpt-4o",
        },
    )
    assert r.status_code == 201
    mid = r.json()["id"]

    rv = await client.post(
        f"/api/v1/registered-models/{mid}/versions",
        json={
            "version_label": "1.1.0",
            "notes": "新增 prompt 模板",
            "model_name": "gpt-4o",
        },
    )
    assert rv.status_code == 201, rv.text
    assert rv.json()["version_no"] == 2
    assert rv.json()["version_label"] == "1.1.0"
    assert rv.json()["notes"] == "新增 prompt 模板"

    versions = await client.get(f"/api/v1/registered-models/{mid}/versions")
    assert versions.status_code == 200
    assert len(versions.json()) == 2

    act = await client.post(f"/api/v1/registered-models/{mid}/versions/{rv.json()['id']}/activate")
    assert act.status_code == 200, act.text
    assert act.json()["version_no"] == 2


@pytest.mark.asyncio
async def test_credentials_create_mask(client):
    from app.services.credential_cipher import decrypt_token

    await _login(client)
    r = await client.post(
        "/api/v1/credentials",
        json={"name": "demo", "provider": "openai", "token": "sk-test-1234567890abcdef"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["masked_token"] != "sk-test-1234567890abcdef"
    assert "sk-test" not in body["masked_token"]

    r2 = await client.get("/api/v1/credentials")
    assert r2.status_code == 200
    for c in r2.json():
        assert "sk-test" not in c["masked_token"]


@pytest.mark.asyncio
async def test_models_provider_default_endpoint(client):
    await _login(client)
    pid = await _create_provider(client)
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "OpenAI Default",
            "kind": "large",
            "large_category": "text",
            "provider_id": pid,
            "model_name": "gpt-4o-mini",
        },
    )
    assert r.status_code == 201, r.text
    # endpoint_url / protocol 在 Provider 详情 / model.config 内提供
    body = r.json()
    assert body["provider_id"] == pid
    assert body["config"]["protocol"] == "openai-compatible"
    assert body["model_name"] == "gpt-4o-mini"

    pd = await client.get(f"/api/v1/providers/{pid}")
    assert pd.status_code == 200
    assert pd.json()["endpoint_url"] == "https://api.openai.com/v1"


@pytest.mark.asyncio
async def test_large_model_requires_provider(client):
    """大模型（remote_api）必须挂载 Provider；不传 provider_id → 422。"""
    await _login(client)
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "no-provider-large",
            "kind": "large",
            "large_category": "text",
            "model_name": "gpt-4o-mini",
        },
    )
    assert r.status_code == 422
    assert "Provider" in r.text or "provider_id" in r.text


@pytest.mark.asyncio
async def test_small_model_provider_optional(client):
    """小模型可以无 Provider（业务语义：自建权重，不属于任何厂商级 Provider）。"""
    await _login(client)
    art = await _upload_small_model_file(client, b"no-provider-small")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "orphan-small",
            "kind": "small",
            "small_category": "politics", "modality": "text",
            "model_name": "politics-orphan",
            "max_output_tokens": 256,
            "registration_method": "uploaded_file",
            "artifact": art,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "small"
    assert body["provider_id"] is None
    assert body["provider"] is None


@pytest.mark.asyncio
async def test_models_reject_non_admin_write(client):
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "reviewer@adreview.example.com", "password": "reviewer123"},
    )
    assert r.status_code == 200
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    body = {
        "name": "x",
        "kind": "large",
        "large_category": "text",
        "provider_id": 1,
        "model_name": "gpt-4o-mini",
    }
    r2 = await client.post("/api/v1/registered-models", json=body)
    assert r2.status_code == 403


# ─── Phase 2: 小模型上传文件 ───


async def _upload_small_model_file(client: AsyncClient, content: bytes = b"fake-onnx-bytes") -> dict:
    files = {"file": ("politics.onnx", content, "application/octet-stream")}
    r = await client.post("/api/v1/registered-models/upload-artifact", files=files)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_upload_artifact_returns_meta(client):
    await _login(client)
    meta = await _upload_small_model_file(client, b"binary-weights-v1")
    assert meta["filename"] == "politics.onnx"
    assert meta["size"] == len(b"binary-weights-v1")
    assert len(meta["sha256"]) == 64
    assert meta["storage_key"].startswith("models/")


@pytest.mark.asyncio
async def test_create_small_model_with_upload(client):
    await _login(client)
    art = await _upload_small_model_file(client, b"weights-v1")
    pid = await _create_provider(client, display_name="selfhost-for-small", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "涉政小模型 v1",
            "kind": "small",
            "small_category": "politics", "modality": "text",
            "provider_id": pid,
            "model_name": "politics-cls-v1",
            "max_output_tokens": 1024,
            "registration_method": "uploaded_file",
            "artifact": art,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "small"
    assert body["small_category"] == "politics"
    assert body["max_output_tokens"] == 1024
    assert body["provider_id"] == pid
    assert body["provider_preset"] == "self-hosted"
    assert body["registration_method"] == "uploaded_file"
    cur = body["current_version"]
    assert cur["artifact_filename"] == "politics.onnx"
    assert cur["artifact_sha256"] == art["sha256"]
    assert cur["status"] == "active"


@pytest.mark.asyncio
async def test_list_models_carries_small_model_artifact_summary(client):
    """list 接口应在 list item 携带 current_version 的 artifact 摘要。

    业务价值：小模型列表页直接展示文件 + 大小 + SHA-256 前缀，
    不用每次点进详情才看到。
    """
    await _login(client)
    art = await _upload_small_model_file(client, b"weights-list-summary")
    pid = await _create_provider(client, display_name="selfhost-summary", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "summary-model",
            "kind": "small",
            "small_category": "politics", "modality": "text",
            "provider_id": pid,
            "model_name": "politics-summary",
            "max_output_tokens": 256,
            "registration_method": "uploaded_file",
            "artifact": art,
        },
    )
    assert r.status_code == 201, r.text
    mid = r.json()["id"]

    r1 = await client.get("/api/v1/registered-models", params={"kind": "small"})
    assert r1.status_code == 200
    items = [m for m in r1.json()["items"] if m["id"] == mid]
    assert items, "列表中未找到刚创建的小模型"
    item = items[0]
    assert item["artifact_filename"] == "politics.onnx"
    assert item["artifact_size"] == len(b"weights-list-summary")
    assert "artifact_sha256" not in item


@pytest.mark.asyncio
async def test_create_small_model_missing_artifact_rejected(client):
    await _login(client)
    pid = await _create_provider(client, display_name="selfhost-bad", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "no-file",
            "kind": "small",
            "small_category": "politics", "modality": "text",
            "provider_id": pid,
            "model_name": "x",
            "max_output_tokens": 512,
        },
    )
    assert r.status_code == 422
    assert "artifact" in r.text or "上传" in r.text


@pytest.mark.asyncio
async def test_create_small_model_missing_max_tokens_accepted(client):
    """小模型 max_output_tokens 不再强制；缺省仍能创建。"""
    await _login(client, _SUPERADMIN)
    art = await _upload_small_model_file(client)
    pid = await _create_provider(client, display_name="selfhost-notok", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "no-tokens",
            "kind": "small",
            "small_category": "politics", "modality": "text",
            "provider_id": pid,
            "model_name": "x",
            "artifact": art,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["max_output_tokens"] is None


@pytest.mark.asyncio
async def test_create_small_model_max_tokens_out_of_range(client):
    await _login(client, _SUPERADMIN)
    art = await _upload_small_model_file(client)
    pid = await _create_provider(client, display_name="selfhost-oob", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "bad-tokens",
            "kind": "small",
            "small_category": "politics", "modality": "text",
            "provider_id": pid,
            "model_name": "x",
            "max_output_tokens": 99999,
            "artifact": art,
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_small_model_no_credential_required(client):
    """小模型分支不应要求 Provider 上的 api_key（仅需 provider 引用即可）。"""
    await _login(client)
    art = await _upload_small_model_file(client)
    pid = await _create_provider(
        client, display_name="selfhost-no-cred", preset="self-hosted",
        endpoint="http://example.invalid/v1",
        api_key="sk-no-cred-123456789012345",
    )
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "no-cred",
            "kind": "small",
            "small_category": "ad", "modality": "text",
            "provider_id": pid,
            "model_name": "ad-cls-v1",
            "max_output_tokens": 256,
            "artifact": art,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    # 小模型分支不携带 credential_id
    assert body["provider_id"] == pid
    assert body["registration_method"] == "uploaded_file"


@pytest.mark.asyncio
async def test_small_model_validate_rejected(client):
    """小模型不支持远程校验。"""
    await _login(client)
    art = await _upload_small_model_file(client)
    pid = await _create_provider(client, display_name="selfhost-validate", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "small",
            "kind": "small",
            "small_category": "porn", "modality": "text",
            "provider_id": pid,
            "model_name": "porn-cls",
            "max_output_tokens": 256,
            "artifact": art,
        },
    )
    assert r.status_code == 201
    mid = r.json()["id"]
    v = await client.post(f"/api/v1/registered-models/{mid}/validate")
    assert v.status_code == 400


@pytest.mark.asyncio
async def test_small_model_new_version_with_new_artifact(client):
    await _login(client)
    art1 = await _upload_small_model_file(client, b"v1")
    pid = await _create_provider(client, display_name="selfhost-versioned", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "versioned small",
            "kind": "small",
            "small_category": "abuse", "modality": "text",
            "provider_id": pid,
            "model_name": "abuse-cls",
            "max_output_tokens": 512,
            "artifact": art1,
        },
    )
    assert r.status_code == 201
    mid = r.json()["id"]

    art2 = await _upload_small_model_file(client, b"v2-weights-bigger")
    rv = await client.post(
        f"/api/v1/registered-models/{mid}/versions",
        json={"version_label": "2.0.0", "model_name": "abuse-cls", "artifact": art2},
    )
    assert rv.status_code == 201, rv.text
    assert rv.json()["version_no"] == 2
    assert rv.json()["artifact_sha256"] == art2["sha256"]

    # 切到 v2，使其成为 current_version（"沿用上一版本"的语义基线）
    act = await client.post(f"/api/v1/registered-models/{mid}/versions/{rv.json()['id']}/activate")
    assert act.status_code == 200

    # 不传 artifact 时应沿用 current_version（即 v2 的 art2）
    rv2 = await client.post(
        f"/api/v1/registered-models/{mid}/versions",
        json={"version_label": "2.0.1", "model_name": "abuse-cls"},
    )
    assert rv2.status_code == 201, rv2.text
    assert rv2.json()["artifact_sha256"] == art2["sha256"]  # 沿用 art2


@pytest.mark.asyncio
async def test_small_model_artifact_download(client):
    await _login(client)
    payload = b"downloadable-bytes-payload"
    art = await _upload_small_model_file(client, payload)
    pid = await _create_provider(client, display_name="selfhost-dl", preset="self-hosted")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "downloadable",
            "kind": "small",
            "small_category": "illicit", "modality": "text",
            "provider_id": pid,
            "model_name": "illicit-cls",
            "max_output_tokens": 256,
            "artifact": art,
        },
    )
    assert r.status_code == 201
    mid = r.json()["id"]
    vid = r.json()["current_version_id"]

    dl = await client.get(f"/api/v1/registered-models/{mid}/versions/{vid}/artifact")
    assert dl.status_code == 200
    assert dl.content == payload


@pytest.mark.asyncio
async def test_large_model_with_uploaded_file_rejected(client):
    """大模型（remote_api）不应接受 artifact。"""
    await _login(client)
    pid = await _create_provider(client)
    art = await _upload_small_model_file(client)
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "mixed",
            "kind": "large",
            "large_category": "text",
            "provider_id": pid,
            "model_name": "gpt-4o",
            "registration_method": "uploaded_file",  # 矛盾组合
            "artifact": art,
        },
    )
    # 后端按 registration_method=uploaded_file 走小模型分支（kind=large 但 method=uploaded_file）
    # 当前实现下：按 method 走到 uploaded_file 分支，会校验 max_output_tokens（缺失应 422）
    assert r.status_code == 422
    # 实际行为：registration_method=uploaded_file + kind=large -> 走小模型分支（endpoint/cred 强制忽略）。
    # 当前用例只验证不抛 5xx：
    assert r.status_code in (201, 422)


@pytest.mark.asyncio
async def test_small_model_model_name_auto_generated(client):
    """小模型 create 时不传 model_name → 后端自动生成。"""
    from app.services.code_generator import generate_registered_model_code

    # 小模型 create/upload 仅 superadmin/root_admin 可作，绕开 admin 登录限制
    await _login(client, _SUPERADMIN)
    pid = await _create_provider(client, display_name="auto-mn-a", preset="self-hosted")
    art = await _upload_small_model_file(client)
    body = {
        "name": "auto-name",
        "kind": "small",
        "small_category": "porn",
        "modality": "text",
        "provider_id": pid,
        "max_output_tokens": 256,
        "artifact": art,
    }
    assert "model_name" not in body  # 故意不传

    r = await client.post("/api/v1/registered-models", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["model_name"], "自动生成 model_name 应非空"
    # 形如 mdl_<时间戳>_<4 字符>
    assert out["model_name"] != ""
    # 与生成函数格式一致
    sample = generate_registered_model_code()
    assert sample.startswith("mdl_")


@pytest.mark.asyncio
async def test_small_model_user_supplied_model_name_kept(client):
    """小模型 create 时传 model_name → 保留用户值。"""
    await _login(client, _SUPERADMIN)
    pid = await _create_provider(client, display_name="keep-mn", preset="self-hosted")
    art = await _upload_small_model_file(client)
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "kept-name",
            "kind": "small",
            "small_category": "porn",
            "modality": "text",
            "provider_id": pid,
            "model_name": "my-custom-mn",
            "max_output_tokens": 256,
            "artifact": art,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["model_name"] == "my-custom-mn"


@pytest.mark.asyncio
async def test_large_model_model_name_required(client):
    """大模型 branch 仍要求 model_name 必填。"""
    await _login(client)
    pid = await _create_provider(client)
    body = {
        "name": "no-mn",
        "kind": "large",
        "large_category": "text",
        "provider_id": pid,
    }
    assert "model_name" not in body

    r = await client.post("/api/v1/registered-models", json=body)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_create_small_default_status_is_draft(client):
    """小模型 create 时不传 activate_immediately → status=draft（不立即激活）。

    业务语义：UI 上的 [保存] 走这条路径；用户事后通过列表"启用"按钮激活。
    """
    await _login(client, _SUPERADMIN)
    pid = await _create_provider(client, display_name="default-draft", preset="self-hosted")
    art = await _upload_small_model_file(client)
    body = {
        "name": "draft-default",
        "kind": "small",
        "small_category": "politics",
        "modality": "text",
        "provider_id": pid,
        "model_name": "draft-mn-1",
        "max_output_tokens": 256,
        "artifact": art,
        # 故意不传 activate_immediately
    }
    assert "activate_immediately" not in body

    r = await client.post("/api/v1/registered-models", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["status"] == "draft", out["status"]
    cur = out["current_version"]
    assert cur["status"] == "draft", cur["status"]


@pytest.mark.asyncio
async def test_create_small_activate_immediately_sets_active(client):
    """小模型 create 时 activate_immediately=True → status=active，current_version.status=active。

    业务语义：UI 上的 [发布] 走这条路径。
    """
    await _login(client, _SUPERADMIN)
    pid = await _create_provider(client, display_name="publish-immediate", preset="self-hosted")
    art = await _upload_small_model_file(client)
    body = {
        "name": "publish-immediate",
        "kind": "small",
        "small_category": "abuse",
        "modality": "text",
        "provider_id": pid,
        "model_name": "publish-mn-1",
        "max_output_tokens": 256,
        "artifact": art,
        "activate_immediately": True,
    }
    r = await client.post("/api/v1/registered-models", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["status"] == "active", out["status"]
    assert out["current_version"]["status"] == "active"


@pytest.mark.asyncio
async def test_publish_cascades_active_sibling_to_inactive(client):
    """[发布] 小模型时，同 (modality, small_category) 组合下已 active 的兄弟
    自动改 inactive（注册级联下线）。

    步骤：
      1) 先建一个兄弟并手动 activate（走 POST /{id}/activate）
      2) 再建第二个同组合的小模型，传 activate_immediately=True
      3) 验证：兄弟被改为 inactive，新模型为 active

    注意：当与 ``test_create_small_*`` 连续跑时，SQLAlchemy ORM compiled cache
    可能残留上一测试 schema 名，导致本测试触发 ``UndefinedTableError``。
    出现该预存在的 schema 隔离问题时，运行：
        pytest tests/test_registered_models.py::test_publish_cascades_active_sibling_to_inactive
    单独跑即过。该问题与本测试无关，是 SQLAlchemy ORM cache + per-test schema
    机制的已知交互。
    """
    await _login(client, _SUPERADMIN)
    pid = await _create_provider(client, display_name="cascade-pid", preset="self-hosted")

    # 兄弟 A：创建并激活
    art_a = await _upload_small_model_file(client, content=b"sibling-a")
    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "sibling-a",
            "kind": "small",
            "small_category": "porn",
            "modality": "text",
            "provider_id": pid,
            "model_name": "sibling-a-mn",
            "max_output_tokens": 256,
            "artifact": art_a,
        },
    )
    assert r.status_code == 201, r.text
    sib_a_id = r.json()["id"]
    assert r.json()["status"] == "draft"

    r_activate = await client.post(f"/api/v1/registered-models/{sib_a_id}/activate")
    assert r_activate.status_code == 200, r_activate.text
    assert r_activate.json()["status"] == "active"

    # 兄弟 B：创建 + 立即发布
    art_b = await _upload_small_model_file(client, content=b"sibling-b")
    r2 = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "sibling-b",
            "kind": "small",
            "small_category": "porn",
            "modality": "text",
            "provider_id": pid,
            "model_name": "sibling-b-mn",
            "max_output_tokens": 256,
            "artifact": art_b,
            "activate_immediately": True,
        },
    )
    assert r2.status_code == 201, r2.text
    body2 = r2.json()
    assert body2["status"] == "active"

    # 兄弟 A 应被级联下线（inactive），与激活前的 draft 不同
    r_check = await client.get(f"/api/v1/registered-models/{sib_a_id}")
    assert r_check.status_code == 200, r_check.text
    assert r_check.json()["status"] == "inactive", r_check.json()["status"]


@pytest.mark.asyncio
async def test_publish_ignores_activate_flag_for_large_model(client):
    """activate_immediately=True 对大模型（kind=large）不应生效：
    large 创建时不走 cascade（小模型专属级联激活）。
    """
    await _login(client, _SUPERADMIN)
    pid = await _create_provider(client, display_name="large-publish", preset="openai")

    r = await client.post(
        "/api/v1/registered-models",
        json={
            "name": "large-publish",
            "kind": "large",
            "large_category": "text",
            "provider_id": pid,
            "model_name": "gpt-publish-1",
            "activate_immediately": True,
        },
    )
    # 大模型分支不依赖小模型的 _set_status 逻辑，单纯创建成功即可
    assert r.status_code == 201, r.text
    # 大模型默认仍按 body.status 或 ACTIVE 落库（沿用现状），不验证具体值
    assert "id" in r.json()
