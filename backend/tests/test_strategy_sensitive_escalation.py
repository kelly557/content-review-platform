"""Tests for strategy_human_review.sensitive_levels escalation logic.

覆盖 should_escalate_to_human 在「敏感」档位下读 sensitive_levels 的判定：
- 风险等级命中 → 升级
- 敏感等级命中 S2/S3 → 升级（不依赖 recall_mode；真正动作切换由 _suggest_action_for）
- 敏感等级命中 S1 → 不升级（永远走脱敏放行）
- 风险+敏感都未命中 → 不升级
- is_enabled=False → 永不升级
- 旧 schema（无 sensitive_levels）→ 行为不变
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


def _make_task(risk: str, sensitive: str = "S0"):
    t = MagicMock()
    t.machine_result = {
        "risk_level": risk,
        "sensitive_level": sensitive,
        "hits": [],
        "rule_hits": [],
    }
    return t


@pytest.mark.asyncio
async def test_disabled_never_escalates():
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {"is_enabled": False, "risk_levels": ["高风险"], "sensitive_levels": ["S3"]}
    for risk in ("高风险", "中风险", "低风险", "无风险", "敏感"):
        task = _make_task(risk, "S3")
        out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
        assert out is False, f"is_enabled=False should never escalate (risk={risk})"


@pytest.mark.asyncio
@pytest.mark.parametrize("risk", ["高风险", "中风险", "低风险", "无风险", "敏感"])
async def test_risk_level_hit_escalates(risk: str):
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {"is_enabled": True, "risk_levels": ["高风险", "中风险", "低风险", "无风险", "敏感"]}
    task = _make_task(risk, "S0")
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is True, f"risk hit must escalate (risk={risk})"


@pytest.mark.asyncio
@pytest.mark.parametrize("risk", ["高风险", "中风险", "低风险", "无风险"])
async def test_non_sensitive_risk_does_not_check_sensitive_levels(risk: str):
    """非「敏感」档位下，sensitive_levels 不参与判定（即使 sensitive 命中）。"""
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {
        "is_enabled": True,
        "risk_levels": [],
        "sensitive_levels": ["S1", "S2", "S3"],
    }
    task = _make_task(risk, "S3")
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is False, f"non-敏感 risk must not escalate from sensitive_levels (risk={risk})"


@pytest.mark.asyncio
@pytest.mark.parametrize("sensitive", ["S2", "S3"])
async def test_sensitive_s2_s3_escalates(sensitive: str):
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {
        "is_enabled": True,
        "risk_levels": [],
        "sensitive_levels": [sensitive],
    }
    task = _make_task("敏感", sensitive)
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is True, f"敏感 + {sensitive} must escalate"


@pytest.mark.asyncio
async def test_sensitive_s1_never_escalates():
    """S1 永远走脱敏放行，不升级人审（即使在 sensitive_levels 里）。"""
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {
        "is_enabled": True,
        "risk_levels": [],
        "sensitive_levels": ["S1", "S2", "S3"],
    }
    task = _make_task("敏感", "S1")
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is False, "敏感 S1 永远不升级人审（由 _suggest_action_for 走 desensitize）"


@pytest.mark.asyncio
async def test_sensitive_s0_does_not_escalate():
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {
        "is_enabled": True,
        "risk_levels": [],
        "sensitive_levels": ["S1", "S2", "S3"],
    }
    task = _make_task("敏感", "S0")
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is False, "敏感 S0 视为未检出敏感内容，不升级"


@pytest.mark.asyncio
async def test_no_match_does_not_escalate():
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {
        "is_enabled": True,
        "risk_levels": ["高风险"],
        "sensitive_levels": ["S3"],
    }
    task = _make_task("中风险", "S0")
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is False, "风险不命中 + 敏感不命中 → 不升级"


@pytest.mark.asyncio
async def test_legacy_config_without_sensitive_levels_field():
    """旧 schema（无 sensitive_levels）→ 行为完全不变。"""
    from app.tasks.machine_review import should_escalate_to_human

    db = MagicMock()
    cfg = {"is_enabled": True, "risk_levels": ["高风险"]}  # 无 sensitive_levels
    task = _make_task("高风险", "S0")
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is True

    task = _make_task("中风险", "S3")
    out = await should_escalate_to_human(db, task, strategy_human_review=cfg)
    assert out is False, "无 sensitive_levels 时，敏感档位不应被误升级"


@pytest.mark.asyncio
async def test_normalized_filters_invalid_values():
    """HumanReviewSettings.normalized 应过滤掉无效 risk_levels / sensitive_levels。"""
    from app.schemas.strategy import HumanReviewSettings

    raw = HumanReviewSettings(
        is_enabled=True,
        risk_levels=["高风险", "零容忍", "无效", "中风险"],
        sensitive_levels=["S1", "S5", "S3", ""],
        review_rule_id=1,
    )
    n = raw.normalized()
    assert n.risk_levels == ["高风险", "中风险"]
    assert n.sensitive_levels == ["S1", "S3"]
    assert n.review_rule_id == 1


@pytest.mark.asyncio
async def test_normalized_disabled_clears_everything():
    from app.schemas.strategy import HumanReviewSettings

    raw = HumanReviewSettings(
        is_enabled=False,
        risk_levels=["高风险"],
        sensitive_levels=["S3"],
        review_rule_id=99,
    )
    n = raw.normalized()
    assert n.is_enabled is False
    assert n.risk_levels == []
    assert n.sensitive_levels == []
    assert n.review_rule_id is None
