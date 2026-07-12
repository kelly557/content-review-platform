"""Tests for app/services/disposition_engine.py.

覆盖：
- merge_disposition_dicts 字段级覆盖 + auto_action_overrides 深合并
- normalize_disposition_dict 清洗逻辑
- compose_effective 端到端（load 两行 dict → merge → normalize）
"""
from __future__ import annotations

import pytest

import app.models  # noqa: F401
from app.services.disposition_engine import (
    compose_effective,
    merge_disposition_dicts,
    normalize_disposition_dict,
)


def test_merge_no_override_returns_base():
    base = {"is_enabled": True, "risk_levels": ["高风险"], "sample_ratio": 100.0}
    out = merge_disposition_dicts(base, None)
    assert out == base


def test_merge_no_base_uses_override():
    ov = {"is_enabled": True, "risk_levels": ["高风险"]}
    out = merge_disposition_dicts(None, ov)
    assert out["is_enabled"] is True
    assert out["risk_levels"] == ["高风险"]


def test_merge_field_level_override():
    base = {
        "is_enabled": True,
        "risk_levels": ["高风险"],
        "sensitive_levels": [],
        "review_rule_id": 1,
        "sample_ratio": 100.0,
        "auto_action_overrides": {"高风险|—": "rejected"},
    }
    ov = {
        "is_enabled": True,
        "risk_levels": ["中风险"],  # override
        "sensitive_levels": [],  # empty 走 base
        "review_rule_id": None,  # None 不覆盖
        "sample_ratio": 50.0,  # override
        "auto_action_overrides": {"中风险|—": "review"},  # 增量 cell
    }
    out = merge_disposition_dicts(base, ov)
    assert out["risk_levels"] == ["中风险"]
    assert out["review_rule_id"] == 1  # base
    assert out["sample_ratio"] == 50.0
    # auto_action_overrides 深合并：base 高风险 + ov 中风险 两个都在
    assert out["auto_action_overrides"]["高风险|—"] == "rejected"
    assert out["auto_action_overrides"]["中风险|—"] == "review"


def test_merge_overrides_disable_is_explicit():
    """override 显式 is_enabled=false 时关掉 strategy 的开启态。"""
    base = {"is_enabled": True, "risk_levels": ["高风险"]}
    ov = {"is_enabled": False, "risk_levels": []}
    out = merge_disposition_dicts(base, ov)
    # 不显式 false ⇒ 保留 base；显式 false ⇒ 关
    # 当前实现只看 override.get("is_enabled") 存在即覆盖
    assert out["is_enabled"] is False


def test_merge_both_empty_returns_empty_dict():
    assert merge_disposition_dicts(None, None) == {}


def test_normalize_disabled_clears_fields():
    payload = {
        "is_enabled": False,
        "risk_levels": ["高风险"],
        "sensitive_levels": [],
        "review_rule_id": None,
        "sample_ratio": None,
        "auto_action_overrides": {},
    }
    out = normalize_disposition_dict(payload)
    # 关人审：应清空 risk_levels 等
    assert out["is_enabled"] is False
    assert out["risk_levels"] == []
    assert out["sample_ratio"] is None


def test_normalize_enabled_keeps_levels():
    payload = {
        "is_enabled": True,
        "risk_levels": ["高风险", "中风险"],
        "sensitive_levels": ["S2"],
        "review_rule_id": 7,
        "sample_ratio": 75.0,
        "auto_action_overrides": {},
    }
    out = normalize_disposition_dict(payload)
    assert out["is_enabled"] is True
    assert out["risk_levels"] == ["中风险", "高风险"] or set(out["risk_levels"]) == {"中风险", "高风险"}
    assert out["sample_ratio"] == 75.0


@pytest.mark.asyncio
async def test_compose_effective_strategy_only(db_session):
    from app.models import DispositionRule

    d = DispositionRule(
        public_id="00000000-0000-0000-0000-000000000010",
        code="dr_test_strategy_only",
        name="test",
        is_enabled=True,
        risk_levels=["高风险"],
        sensitive_levels=["S2"],
        review_rule_id=None,
        sample_ratio=100.0,
        auto_action_overrides={},
    )
    db_session.add(d)
    await db_session.flush()

    out = await compose_effective(db_session, strategy_disposition_id=d.id, override_disposition_id=None)
    assert out["is_enabled"] is True
    assert set(out["risk_levels"]) == {"高风险"}


@pytest.mark.asyncio
async def test_compose_effective_with_override_overrides_fields(db_session):
    from app.models import DispositionRule

    base = DispositionRule(
        public_id="00000000-0000-0000-0000-000000000011",
        code="dr_test_base",
        name="base",
        is_enabled=True,
        risk_levels=["高风险", "中风险"],
        sensitive_levels=[],
        review_rule_id=None,
        sample_ratio=100.0,
        auto_action_overrides={"高风险|—": "rejected"},
    )
    ov = DispositionRule(
        public_id="00000000-0000-0000-0000-000000000012",
        code="dr_test_override",
        name="override",
        is_enabled=True,
        risk_levels=["中风险"],
        sensitive_levels=[],
        review_rule_id=None,
        sample_ratio=50.0,
        auto_action_overrides={"中风险|—": "review"},
    )
    db_session.add_all([base, ov])
    await db_session.flush()

    out = await compose_effective(
        db_session,
        strategy_disposition_id=base.id,
        override_disposition_id=ov.id,
    )
    assert set(out["risk_levels"]) == {"中风险"}
    assert out["sample_ratio"] == 50.0
    # auto_action_overrides 合并：base 高风险被 retain；override 中风险加入
    assert out["auto_action_overrides"].get("高风险|—") == "rejected"
    assert out["auto_action_overrides"].get("中风险|—") == "review"


@pytest.mark.asyncio
async def test_compose_effective_no_strategy_no_override(db_session):
    out = await compose_effective(db_session, None, None)
    assert out["is_enabled"] is False
    assert out["risk_levels"] == []
