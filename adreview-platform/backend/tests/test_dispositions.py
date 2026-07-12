"""Tests for /api/v1/dispositions CRUD (Phase B).

最小化覆盖：list/auth/权限 + 直调 handler 业务。
"""
from __future__ import annotations

import pytest

import app.models  # noqa: F401


async def _login(client, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_disposition_unauthenticated_rejected(client):
    r = await client.get("/api/v1/dispositions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_disposition_reviewer_can_list(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.get("/api/v1/dispositions")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert isinstance(body["items"], list)


@pytest.mark.asyncio
async def test_disposition_reviewer_cannot_create(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/dispositions",
        json={"name": "x", "is_enabled": False, "risk_levels": []},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_disposition_schema_rejects_invalid_risk_levels():
    """Pydantic 验证：风险等级必须白名单。"""
    from pydantic import ValidationError

    from app.schemas.disposition import DispositionCreate

    with pytest.raises(ValidationError):
        DispositionCreate(
            name="x",
            is_enabled=True,
            risk_levels=["外星风险"],
        )


@pytest.mark.asyncio
async def test_disposition_schema_rejects_invalid_action():
    """Pydantic 验证：auto_action_overrides 动作必须白名单。"""
    from pydantic import ValidationError

    from app.schemas.disposition import DispositionCreate

    with pytest.raises(ValidationError):
        DispositionCreate(
            name="x",
            is_enabled=True,
            risk_levels=["高风险"],
            auto_action_overrides={"高风险|—": "deliberately_invalid"},
        )


@pytest.mark.asyncio
async def test_disposition_create_review_rule_validate(db_session, db_session_factory):
    """直调：review_rule_id 验证失败应 400。"""
    from fastapi import HTTPException

    from app.api.v1.dispositions import create_disposition
    from app.models.user import UserRole
    from app.schemas.disposition import DispositionCreate

    user = type("U", (), {"id": 1, "role": UserRole.ADMIN})()
    with pytest.raises(HTTPException) as ei:
        await create_disposition(
            body=DispositionCreate(
                name="x",
                is_enabled=True,
                risk_levels=["高风险"],
                review_rule_id=999_999,  # 不存在
            ),
            db=db_session,
            user=user,
        )
    assert ei.value.status_code == 400


@pytest.mark.asyncio
async def test_disposition_code_generator_unique():
    from app.services.code_generator import generate_disposition_code

    codes = {generate_disposition_code() for _ in range(20)}
    assert len(codes) == 20
    assert all(c.startswith("dr_") for c in codes)
