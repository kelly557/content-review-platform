"""Tests for /api/v1/rule-sets CRUD (Phase B).

覆盖范围（最小化）:
- list / auth / 权限边界（不触发 AuditPoint lazy=selectin 路径）
- 业务逻辑：handler 直调用 + 自建 db session（避开测试间 asyncpg cache schema-staleness）

注：项目 conftest.py 的 db_engine fixture 不关闭 asyncpg prepared statement cache，
跨 per-test schema 时会携带旧 schema 引用导致 SELECT 失败（已知问题，与本测试无关）。
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401


# ── 简易 auth 测试（仅 GET/list — 不触碰 AuditPoint/Strategy 关系） ──
async def _login(client, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_rule_set_unauthenticated_rejected(client):
    r = await client.get("/api/v1/rule-sets")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_rule_set_reviewer_can_list(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.get("/api/v1/rule-sets")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and "total" in body
    assert isinstance(body["items"], list)


@pytest.mark.asyncio
async def test_rule_set_reviewer_cannot_create(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/rule-sets",
        json={"name": "test", "points": []},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_rule_set_create_invalid_point_returns_400(db_session):
    """直调 handler 走 _validate_points 的 raw-SQL 路径，避开 AuditPoint lazy。"""
    from fastapi import HTTPException

    from app.api.v1.rule_sets import create_rule_set
    from app.models.user import UserRole
    from app.schemas.rule_set import RuleSetCreate

    user = type("U", (), {"id": 1, "role": UserRole.ADMIN})()
    with pytest.raises(HTTPException) as ei:
        await create_rule_set(
            body=RuleSetCreate(
                name="x",
                points=[
                    {
                        "media_type": "text",
                        "item_id": 999_999,
                        "point_id": 999_999,
                        "is_enabled": True,
                    }
                ],
            ),
            db=db_session,
            user=user,
        )
    assert ei.value.status_code == 400


@pytest.mark.asyncio
async def test_rule_set_builtin_protected_direct(db_session, db_session_factory):
    """直调：内置规则不可改。"""
    from app.api.v1.rule_sets import update_rule_set
    from app.models.rule_set import RuleSet
    from app.models.user import UserRole
    from app.schemas.rule_set import RuleSetUpdate

    async with db_session_factory() as s:
        rs = RuleSet(
            public_id="00000000-0000-0000-0000-000000000301",
            code="rs_builtin_test",
            name="内置",
            config={},
            is_builtin=True,
            is_editable=False,
        )
        s.add(rs)
        await s.commit()
        await s.refresh(rs)
        rid = rs.id

    user = type("U", (), {"id": 1, "role": UserRole.ADMIN})()
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        await update_rule_set(
            rule_set_id=rid,
            body=RuleSetUpdate(name="rename"),
            db=db_session,
            user=user,
        )
    assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_rule_set_code_generator_unique():
    from app.services.code_generator import generate_rule_set_code

    codes = {generate_rule_set_code() for _ in range(20)}
    assert len(codes) == 20  # 全部互异
    assert all(c.startswith("rs_") for c in codes)
