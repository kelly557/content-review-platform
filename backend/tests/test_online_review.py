"""Tests for online review detect endpoint.

覆盖: 鉴权 / default 策略兜底 / 显式策略不存在 404 / 策略 llm_review 关闭时
仅词库 / 大模型未配置时降级带 llm_error / 词库命中联动.
"""
from __future__ import annotations

import pytest

from app.models.library import Library, LibraryKind, LibraryType
from app.models.library_item import LibraryItem
from app.models.strategy import Strategy, StrategyScope
from app.models.workflow import WorkflowTemplate

pytestmark = pytest.mark.asyncio


async def _login(client, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login",
        json={"identifier": email, "password": password},
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


async def _seed_template(session) -> WorkflowTemplate:
    """auto_only 模板 — online_review detect 创建 WorkflowInstance 时依赖."""
    tpl = WorkflowTemplate(
        code="auto_only",
        name="全自动机审",
        definition={
            "stages": [
                {
                    "key": "ai_scan",
                    "name": "AI 智能扫描",
                    "type": "machine",
                    "mode": "single",
                    "role": "system",
                }
            ]
        },
        is_active=True,
    )
    session.add(tpl)
    await session.commit()
    await session.refresh(tpl)
    return tpl


async def _make_strategy(
    session,
    *,
    code: str,
    name: str,
    scope: StrategyScope = StrategyScope.GENERAL,
    definition: dict | None = None,
    is_active: bool = True,
) -> Strategy:
    strat = Strategy(
        code=code,
        name=name,
        scope=scope,
        is_active=is_active,
        definition=definition or {},
    )
    session.add(strat)
    await session.commit()
    await session.refresh(strat)
    return strat


async def _make_word_library(
    session,
    *,
    code: str,
    name: str,
    words: list[str],
    kind: LibraryKind = LibraryKind.BLACKLIST,
    is_platform: bool = False,
) -> Library:
    lib = Library(
        code=code,
        name=name,
        library_type=LibraryType.WORD,
        kind=kind,
        is_active=True,
        is_platform=is_platform,
    )
    session.add(lib)
    await session.flush()
    for w in words:
        session.add(LibraryItem(library_id=lib.id, word=w))
    await session.commit()
    return lib


async def test_detect_returns_compliant_for_clean_text(client, db_session):
    await _seed_template(db_session)
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/online-review/detect",
        json={
            "media_type": "text",
            "mode": "single",
            "items": [{"kind": "text", "name": "t", "text": "这是一段普通文案"}],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "conclusion" in body
    assert "log_id" in body
    assert "conclusionType" in body
    assert isinstance(body["data"], list)
    assert len(body["data"]) >= 1
    assert "latency_ms" in body
    # 去掉 mock 字段: 不应再出现 phoneRisk / isHitMd5
    assert "phoneRisk" not in body
    assert "isHitMd5" not in body
    # 新增字段存在
    assert "engines_used" in body
    assert "model" in body
    assert "llm_error" in body
    assert "strategy" in body


async def test_detect_requires_auth(client):
    r = await client.post(
        "/api/v1/online-review/detect",
        json={"items": [{"kind": "text", "text": "x"}]},
    )
    assert r.status_code == 401


async def test_detect_strategy_not_found_returns_404(client):
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/online-review/detect",
        json={
            "strategy_id": 999999,
            "items": [{"kind": "text", "text": "x"}],
        },
    )
    assert r.status_code == 404


async def test_detect_uses_default_strategy_when_none_specified(client, db_session):
    await _seed_template(db_session)
    # 造一个 default 单例策略
    strat = await _make_strategy(
        db_session,
        code="test-default",
        name="测试默认策略",
        scope=StrategyScope.DEFAULT,
        definition={"services": ["text_detection_pro"], "llm_review": {"is_enabled": False}},
    )
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/online-review/detect",
        json={"items": [{"kind": "text", "text": "普通文案"}]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # 应回退到 default 单例策略
    assert body["strategy"] == {"id": strat.id, "name": "测试默认策略"}
    # llm_review 关闭 → 只有 wordset 引擎, 无 model / llm_error
    assert body["engines_used"] == ["wordset"]
    assert body["model"] is None
    assert body["llm_error"] is None


async def test_detect_llm_disabled_strategy_only_runs_wordset(client, db_session):
    await _seed_template(db_session)
    strat = await _make_strategy(
        db_session,
        code="no-llm",
        name="无大模型策略",
        definition={
            "services": ["text_detection_pro"],
            "llm_review": {"is_enabled": False},
        },
    )
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/online-review/detect",
        json={"strategy_id": strat.id, "items": [{"kind": "text", "text": "x"}]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engines_used"] == ["wordset"]
    assert body["model"] is None
    assert body["llm_error"] is None


async def test_detect_llm_enabled_but_no_key_degrades_with_error(client, db_session, monkeypatch):
    await _seed_template(db_session)
    # 策略开启大模型但未指定 model_id → 回退全局 MAAS; 这里把 key 置空触发降级
    from app.core.config import settings

    monkeypatch.setattr(settings, "maas_api_key", "")
    strat = await _make_strategy(
        db_session,
        code="llm-no-key",
        name="大模型未配置策略",
        definition={
            "services": ["text_detection_pro"],
            "llm_review": {"is_enabled": True, "model_id": None},
        },
    )
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/online-review/detect",
        json={"strategy_id": strat.id, "items": [{"kind": "text", "text": "普通文案"}]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # 词库引擎照跑, llm 因未配置降级
    assert "wordset" in body["engines_used"]
    assert "llm" not in body["engines_used"]
    assert body["llm_error"] is not None
    assert "未配置" in body["llm_error"] or "配置" in body["llm_error"]


async def test_detect_wordset_hit_marks_non_compliant(client, db_session):
    await _seed_template(db_session)
    # 造一个平台黑名单词库, 内含敏感词; 策略不挂任何库 → 平台库仍生效
    await _make_word_library(
        db_session,
        code="plat-banned",
        name="平台违禁词库",
        words=["绝 对 化 词汇占位符_测试_违规词"],
        is_platform=True,
    )
    strat = await _make_strategy(
        db_session,
        code="ws-hit",
        name="词库命中策略",
        definition={
            "services": ["text_detection_pro"],
            "llm_review": {"is_enabled": False},
        },
    )
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/online-review/detect",
        json={
            "strategy_id": strat.id,
            "items": [{"kind": "text", "text": "含 绝 对 化 词汇占位符_测试_违规词 的文案"}],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["conclusion"] == "不合规"
    assert body["conclusionType"] == 2
    assert body["data"][0]["hits"]
    assert any(
        "违规词" in (h.get("rule_label") or "") or "黑名单" in (h.get("rule_label") or "")
        for h in body["data"][0]["hits"]
    )
