"""merge_human_review 合并语义测试。

覆盖字段级合并 + auto_action_overrides 深合并 + normalized() 一致性。
"""
from __future__ import annotations

import pytest

from app.schemas.strategy import HumanReviewSettings
from app.services.human_review_merge import (
    merge_and_normalize_human_review,
    merge_human_review,
)


# ── 基础：override=None 时完全返回 strategy 原文 ─────────────────────────────


def test_no_override_returns_strategy_unchanged():
    strategy = {
        "is_enabled": True,
        "risk_levels": ["高风险"],
        "sample_ratio": 50.0,
    }
    assert merge_human_review(strategy, None) == strategy


def test_no_strategy_no_override_returns_empty():
    assert merge_human_review(None, None) == {}


# ── 单字段覆盖 ──────────────────────────────────────────────────


def test_override_is_enabled():
    strategy = {"is_enabled": True, "risk_levels": ["高风险"]}
    override = HumanReviewSettings(is_enabled=False)
    out = merge_and_normalize_human_review(strategy, override)
    # 关人审时 normalized 会清空 risk_levels
    assert out["is_enabled"] is False
    assert out["risk_levels"] == []


def test_override_risk_levels_replaces_list():
    strategy = {"is_enabled": True, "risk_levels": ["高风险"], "sensitive_levels": []}
    override = HumanReviewSettings(risk_levels=["低风险"])
    out = merge_human_review(strategy, override)
    assert out["risk_levels"] == ["低风险"]


def test_override_empty_risk_levels_keeps_strategy():
    """override.risk_levels=[] 视为「不覆盖」，保留 strategy。"""
    strategy = {"risk_levels": ["高风险"]}
    override = HumanReviewSettings(risk_levels=[])
    out = merge_human_review(strategy, override)
    assert out["risk_levels"] == ["高风险"]


def test_override_sensitive_levels():
    strategy = {"sensitive_levels": ["S2"]}
    override = HumanReviewSettings(sensitive_levels=["S2", "S3"])
    out = merge_human_review(strategy, override)
    assert out["sensitive_levels"] == ["S2", "S3"]


def test_override_review_rule_id():
    strategy = {"review_rule_id": 5}
    override = HumanReviewSettings(review_rule_id=10)
    out = merge_human_review(strategy, override)
    assert out["review_rule_id"] == 10


def test_override_review_rule_id_none_keeps_strategy():
    """override.review_rule_id=None 视为「不覆盖」。"""
    strategy = {"review_rule_id": 5}
    override = HumanReviewSettings(review_rule_id=None)
    out = merge_human_review(strategy, override)
    assert out["review_rule_id"] == 5


def test_override_sample_ratio():
    strategy = {"sample_ratio": 100.0}
    override = HumanReviewSettings(sample_ratio=30.0)
    out = merge_human_review(strategy, override)
    assert out["sample_ratio"] == 30.0


def test_override_sample_ratio_none_keeps_strategy():
    strategy = {"sample_ratio": 80.0}
    override = HumanReviewSettings(sample_ratio=None)
    out = merge_human_review(strategy, override)
    assert out["sample_ratio"] == 80.0


# ── auto_action_overrides 深合并 ─────────────────────────────────


def test_override_auto_action_overrides_deep_merge():
    strategy = {
        "auto_action_overrides": {
            "高风险|—": "rejected",
            "中风险|—": "rejected",
        }
    }
    override = HumanReviewSettings(auto_action_overrides={"中风险|—": "approved"})
    out = merge_human_review(strategy, override)
    assert out["auto_action_overrides"]["高风险|—"] == "rejected"
    assert out["auto_action_overrides"]["中风险|—"] == "approved"  # 覆盖


def test_override_empty_auto_action_overrides_keeps_strategy():
    strategy = {"auto_action_overrides": {"高风险|—": "rejected"}}
    override = HumanReviewSettings(auto_action_overrides={})
    out = merge_human_review(strategy, override)
    assert out["auto_action_overrides"] == {"高风险|—": "rejected"}


def test_override_auto_action_overrides_no_strategy_dict():
    strategy = {}
    override = HumanReviewSettings(auto_action_overrides={"高风险|—": "rejected"})
    out = merge_human_review(strategy, override)
    assert out["auto_action_overrides"] == {"高风险|—": "rejected"}


# ── 组合：多字段同时覆盖 ──────────────────────────────────────────


def test_override_multiple_fields_at_once():
    strategy = {
        "is_enabled": True,
        "risk_levels": ["高风险"],
        "sample_ratio": 100.0,
        "review_rule_id": 1,
    }
    override = HumanReviewSettings(
        risk_levels=["高风险", "中风险"],
        sample_ratio=30.0,
    )
    out = merge_human_review(strategy, override)
    assert out["is_enabled"] is True  # 未覆盖
    assert out["risk_levels"] == ["高风险", "中风险"]  # 覆盖
    assert out["sample_ratio"] == 30.0  # 覆盖
    assert out["review_rule_id"] == 1  # 未覆盖


# ── normalized 一致性：override 关人审时清空其他字段 ────────────────────────


def test_normalize_disabled_clears_levels():
    """override 关人审 → 全部清空（normalized 一致性）。"""
    strategy = {
        "is_enabled": True,
        "risk_levels": ["高风险"],
        "sample_ratio": 50.0,
        "review_rule_id": 7,
    }
    override = HumanReviewSettings(is_enabled=False)
    out = merge_and_normalize_human_review(strategy, override)
    assert out["is_enabled"] is False
    assert out["risk_levels"] == []
    assert out["sample_ratio"] is None
    assert out["review_rule_id"] is None


def test_normalize_enabled_with_sample_ratio_default():
    """override 启用人审但没传 sample_ratio → 默认 100。"""
    strategy = {"is_enabled": False}
    override = HumanReviewSettings(is_enabled=True, risk_levels=["低风险"])
    out = merge_and_normalize_human_review(strategy, override)
    assert out["is_enabled"] is True
    assert out["risk_levels"] == ["低风险"]
    assert out["sample_ratio"] == 100.0


# ── 边界：空 strategy + 完整 override ─────────────────────────────────


def test_empty_strategy_with_full_override():
    strategy = {}
    override = HumanReviewSettings(
        is_enabled=True,
        risk_levels=["高风险"],
        sample_ratio=20.0,
        review_rule_id=3,
    )
    out = merge_and_normalize_human_review(strategy, override)
    assert out["is_enabled"] is True
    assert out["risk_levels"] == ["高风险"]
    assert out["sample_ratio"] == 20.0
    assert out["review_rule_id"] == 3


# ── 边界：strategy + 空 override（所有字段为 None/[]） ─────────────────────


def test_empty_override_keeps_all_strategy_fields():
    strategy = {
        "is_enabled": True,
        "risk_levels": ["高风险"],
        "sensitive_levels": ["S3"],
        "review_rule_id": 5,
        "sample_ratio": 80.0,
        "auto_action_overrides": {"高风险|—": "rejected"},
    }
    override = HumanReviewSettings()  # 全部 None/[]
    out = merge_and_normalize_human_review(strategy, override)
    assert out == strategy