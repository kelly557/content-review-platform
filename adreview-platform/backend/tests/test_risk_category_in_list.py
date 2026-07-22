"""_validate_small_category 走 risk_categories 字典的验证。"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


SUPERADMIN = {
    "email": "superadmin@adreview.example.com",
    "password": "superadmin123",
}


async def _login(client: AsyncClient) -> None:
    r = await client.post("/api/v1/auth/login", json=SUPERADMIN)
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_list_accepts_custom_risk_category_code(client):
    """list 接口：自定义 risk_category code 不应 422。"""
    from app.models.risk_category import RiskCategory
    from sqlalchemy import select
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        exists = (
            await session.execute(
                select(RiskCategory).where(RiskCategory.code == "risk_4")
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(
                RiskCategory(
                    code="risk_4", label="Custom 4", color="red",
                    sort_order=99, is_builtin=False,
                )
            )
            await session.commit()

    await _login(client)
    r = await client.get(
        "/api/v1/registered-models",
        params={"kind": "small", "modality": "text", "small_category": "risk_4"},
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_list_builtin_enum_still_valid(client):
    """历史 enum value 仍然放行。"""
    await _login(client)
    r = await client.get(
        "/api/v1/registered-models",
        params={"kind": "small", "modality": "text", "small_category": "politics"},
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_list_unknown_code_still_422(client):
    """既不是 enum 也不是 risk_category 的 code → 422。"""
    await _login(client)
    r = await client.get(
        "/api/v1/registered-models",
        params={
            "kind": "small", "modality": "text",
            "small_category": "totally_made_up_code",
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_cache_invalidated_after_create(client):
    """POST /risk-categories 创建后，缓存失效，下次 list 接口能命中新 code。"""
    from app.api.v1.registered_models import (
        invalidate_risk_category_cache,
    )
    invalidate_risk_category_cache()

    await _login(client)
    # 创建前先确认 list 422
    pre = await client.get(
        "/api/v1/registered-models",
        params={"kind": "small", "modality": "text",
                "small_category": "brand_new_code"},
    )
    assert pre.status_code == 422

    # 创建
    r = await client.post(
        "/api/v1/risk-categories", json={"label": "Brand New Code"}
    )
    assert r.status_code == 201, r.text
    code = r.json()["code"]
    assert code == "brand_new_code"

    # 列表查询应放行
    post = await client.get(
        "/api/v1/registered-models",
        params={"kind": "small", "modality": "text",
                "small_category": code},
    )
    assert post.status_code == 200, post.text
