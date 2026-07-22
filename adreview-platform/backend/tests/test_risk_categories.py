"""Risk category API tests."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


SUPERADMIN = {
    "email": "superadmin@adreview.example.com",
    "password": "superadmin123",
}
ADMIN = {
    "email": "admin@adreview.example.com",
    "password": "admin123",
}


async def _login(client: AsyncClient, who: dict = SUPERADMIN) -> None:
    r = await client.post("/api/v1/auth/login", json=who)
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_list_risk_categories_requires_auth(client):
    r = await client.get("/api/v1/risk-categories")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_risk_categories_empty(client):
    """新 schema 下没有任何内置 seed——验证空 list。"""
    await _login(client, ADMIN)
    r = await client.get("/api/v1/risk-categories")
    assert r.status_code == 200, r.text
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_requires_superadmin(client):
    """admin / mlr / reviewer 不能新建。"""
    await _login(client, ADMIN)
    r = await client.post("/api/v1/risk-categories", json={"label": "XSS 类风险"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_then_list(client):
    """superadmin 创建一条 → list 能看到 → code 自动生成。"""
    await _login(client, SUPERADMIN)
    body = {"label": "XSS 类风险"}
    r = await client.post("/api/v1/risk-categories", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["code"] == "xss"  # 字母小写 + slug
    assert out["label"] == "XSS 类风险"
    assert out["is_builtin"] is False
    assert out["color"] in {
        "red", "orange", "gold", "green", "blue",
        "purple", "magenta", "volcano", "default",
    }

    r2 = await client.get("/api/v1/risk-categories")
    assert r2.status_code == 200
    codes = [c["code"] for c in r2.json()]
    assert "xss" in codes


@pytest.mark.asyncio
async def test_create_label_empty_422(client):
    await _login(client, SUPERADMIN)
    r = await client.post("/api/v1/risk-categories", json={"label": "   "})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_collision_appends_suffix(client):
    """同名 label 两次 → 第二次 code 变为 xss_2。"""
    await _login(client, SUPERADMIN)
    await client.post("/api/v1/risk-categories", json={"label": "XSS 类风险"})
    r2 = await client.post("/api/v1/risk-categories", json={"label": "XSS 类风险"})
    assert r2.status_code == 201, r2.text
    assert r2.json()["code"] == "xss_2"


@pytest.mark.asyncio
async def test_create_avoid_collide_with_builtin_codes(client):
    """label='ad' 不应直接拿走内置 ad code，应变成 custom_ad。"""
    await _login(client, SUPERADMIN)
    r = await client.post("/api/v1/risk-categories", json={"label": "ad"})
    assert r.status_code == 201, r.text
    # 历史上内置 enum 中有 code='ad'，自定义避免撞名
    assert r.json()["code"] == "custom_ad"


@pytest.mark.asyncio
async def test_update_builtin_forbidden(client, db_session):
    """系统预置的内置项不能 PATCH。"""
    from app.models.risk_category import RiskCategory
    db_session.add(
        RiskCategory(
            code="politics", label="涉政", color="red",
            sort_order=0, is_builtin=True,
        )
    )
    await db_session.commit()

    await _login(client, SUPERADMIN)
    r = await client.patch("/api/v1/risk-categories/politics", json={"label": "修改"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_in_use_forbidden(client, db_session):
    """小模型引用某个 code → DELETE 失败。"""
    from app.models.risk_category import RiskCategory
    from app.models.registered_model import RegisteredModel, RegisteredModelKind, RegisteredModelStatus
    db_session.add(
        RiskCategory(
            code="custom_xss", label="XSS", color="red",
            sort_order=99, is_builtin=False,
        )
    )
    db_session.add(
        RegisteredModel(
            code="m_xss_1",
            name="xss-cls",
            kind=RegisteredModelKind.SMALL.value,
            small_category="custom_xss",
            modality="text",
            registration_method="uploaded_file",
            status=RegisteredModelStatus.DRAFT.value,
        )
    )
    await db_session.commit()

    await _login(client, SUPERADMIN)
    r = await client.delete("/api/v1/risk-categories/custom_xss")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_delete_unused_succeeds(client):
    await _login(client, SUPERADMIN)
    body = {"label": "临时风险类型"}
    r = await client.post("/api/v1/risk-categories", json=body)
    code = r.json()["code"]

    d = await client.delete(f"/api/v1/risk-categories/{code}")
    assert d.status_code == 204


@pytest.mark.asyncio
async def test_delete_builtin_forbidden(client, db_session):
    from app.models.risk_category import RiskCategory
    db_session.add(
        RiskCategory(
            code="politics", label="涉政", color="red",
            sort_order=0, is_builtin=True,
        )
    )
    await db_session.commit()

    await _login(client, SUPERADMIN)
    r = await client.delete("/api/v1/risk-categories/politics")
    assert r.status_code == 403
