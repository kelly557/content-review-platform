"""Tests for strategy_tag_refs real query + agent parse-doc endpoint."""
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


async def test_tag_references_empty_for_unreferenced_tag(client, db_session):
    """标签未被任何策略引用时，references 返回空 strategies（不再有 mock 数据）。"""
    from app.models.tag import Tag, TagDomain, TagCategory, TagStatus
    from app.services.tag import build_references_for_tag

    tag = Tag(
        code="test_l3_unreferenced",
        name="测试未引用标签",
        domain=TagDomain.POLITICS,
        category=TagCategory.CLAIM,
        status=TagStatus.ACTIVE,
        level=3,
    )
    db_session.add(tag)
    await db_session.commit()
    await db_session.refresh(tag)

    resp = await build_references_for_tag(db_session, tag.id)
    assert resp.strategies == []
    assert resp.can_delete is True


async def test_tag_references_via_strategy_tag_refs(client, db_session):
    """策略经 strategy_tag_refs 关联后，references 返回真实策略。"""
    from app.models.strategy import Strategy
    from app.models.strategy_tag_ref import StrategyTagRef
    from app.models.tag import Tag, TagDomain, TagCategory, TagStatus
    from app.services.tag import build_references_for_tag

    tag = Tag(
        code="test_l3_referenced",
        name="测试已引用标签",
        domain=TagDomain.POLITICS,
        category=TagCategory.CLAIM,
        status=TagStatus.ACTIVE,
        level=3,
    )
    strat = Strategy(
        code="st_test_ref",
        name="引用测试策略",
        is_active=True,
        definition={"services": [{"code": "text_detection_pro"}]},
    )
    db_session.add_all([tag, strat])
    await db_session.commit()
    await db_session.refresh(tag)
    await db_session.refresh(strat)

    ref = StrategyTagRef(strategy_id=strat.id, tag_id=tag.id)
    db_session.add(ref)
    await db_session.commit()

    resp = await build_references_for_tag(db_session, tag.id)
    assert len(resp.strategies) == 1
    assert resp.strategies[0].strategy_name == "引用测试策略"
    assert resp.strategies[0].status == "active"
    assert resp.can_deactivate is False
    assert resp.can_delete is False


async def test_parse_doc_endpoint(client):
    """POST /review-agents/parse-doc 接受 txt 上传并返回结构化结果。"""
    await _login(client, "admin@adreview.example.com", "admin123")
    content = "1. 涉政内容检测\n2. 广告法极限词检测".encode("utf-8")
    files = {"file": ("rules.txt", content, "text/plain")}
    r = await client.post("/api/v1/review-agents/parse-doc", files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "points" in body
    assert "source_info" in body
    assert isinstance(body["points"], list)
