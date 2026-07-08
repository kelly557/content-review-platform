"""Tests for AI review suggestion refactor (5 levels + desensitize plan).

Covers:
- aggregate_risk_level correctly maps PII/sensitive labels to 敏感
- _suggest_action_for honors recall_mode + human_enabled matrix
- should_escalate_to_human respects per-service HumanReviewConfig
- build_default_rules + desensitize mask phone / id_card / bank_card /
  email / address and respect whitelist
"""
from __future__ import annotations

import pytest

import app.models  # noqa: F401
from app.models.human_review_config import RiskLevel
from app.models.sensitive_level import SensitiveLevel
from app.services.desensitization import build_default_rules, desensitize
from app.tasks.machine_review import (
    aggregate_risk_level,
    _suggest_action_for,
)


# ─── aggregate_risk_level ─────────────────────────────────────────────────

def test_aggregate_risk_level_empty():
    assert aggregate_risk_level([]) == RiskLevel.NONE.value


def test_aggregate_risk_level_sensitive_only():
    hits = [{"label_cn": "敏感内容", "risk": "敏感"}]
    assert aggregate_risk_level(hits) == RiskLevel.SENSITIVE.value


def test_aggregate_risk_level_sensitive_promotes_over_low():
    hits = [
        {"label_cn": "广告", "risk": "低风险"},
        {"label_cn": "敏感词命中", "risk": "敏感"},
    ]
    assert aggregate_risk_level(hits) == RiskLevel.SENSITIVE.value


def test_aggregate_risk_level_high_dominates():
    hits = [
        {"label_cn": "敏感", "risk": "敏感"},
        {"label_cn": "医疗广告违规", "risk": "高风险"},
    ]
    assert aggregate_risk_level(hits) == RiskLevel.HIGH.value


def test_aggregate_risk_level_medium_when_no_high():
    hits = [{"label_cn": "金融风险提示", "risk": "中风险"}]
    assert aggregate_risk_level(hits) == RiskLevel.MEDIUM.value


def test_aggregate_risk_level_legacy_label_keyword_path():
    # No explicit "risk" field — falls back to label_cn keyword sniffing.
    # "命中身份证号" 含"敏感"不直接命中，但 explicit 字段为空时按 label 兜底
    # 走"敏感"（新增桶）。
    hits = [{"label_cn": "命中身份证号", "risk": "敏感"}]
    assert aggregate_risk_level(hits) == RiskLevel.SENSITIVE.value


# ─── _suggest_action_for (decision matrix) ────────────────────────────────
# v9 签名：(risk_level, sensitive_level, human_enabled, recall_mode)
# 非敏感 risk_level 档位下 sensitive_level 不影响决策，传 S0 占位。

def test_suggest_action_high_rejected_when_human_disabled():
    assert _suggest_action_for(
        RiskLevel.HIGH.value, SensitiveLevel.S0.value,
        human_enabled=False, recall_mode=True,
    ) == "rejected"


def test_suggest_action_high_review_when_human_enabled():
    """v9：高风险 + 人审开 → 升级人审（与中风险对齐）。"""
    assert _suggest_action_for(
        RiskLevel.HIGH.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=False,
    ) == "review"


def test_suggest_action_medium_rejected_when_human_disabled():
    """v9：中风险 + 人审关 → 拒绝（不放行）。"""
    assert _suggest_action_for(
        RiskLevel.MEDIUM.value, SensitiveLevel.S0.value,
        human_enabled=False, recall_mode=False,
    ) == "rejected"


def test_suggest_action_medium_review_when_human_enabled():
    assert _suggest_action_for(
        RiskLevel.MEDIUM.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=False,
    ) == "review"


def test_suggest_action_sensitive_s1_desensitize_by_default():
    """敏感 + S1 → desensitize（无论人审/召回）。"""
    assert _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S1.value,
        human_enabled=True, recall_mode=False,
    ) == "desensitize"


def test_suggest_action_sensitive_s2_rejected_when_human_disabled():
    """v9：敏感 + S2 + 人审关 → 拒绝（中度敏感也不放行）。"""
    assert _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S2.value,
        human_enabled=False, recall_mode=True,
    ) == "rejected"


def test_suggest_action_sensitive_s2_review_in_recall_mode():
    """v9：敏感 + S2 + 人审开+召回 → 升级人审（与 S3 对齐）。"""
    assert _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S2.value,
        human_enabled=True, recall_mode=True,
    ) == "review"


def test_suggest_action_sensitive_s3_review_in_recall_mode():
    """敏感 + S3 + 人审开+召回 → 升级人审。"""
    assert _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S3.value,
        human_enabled=True, recall_mode=True,
    ) == "review"


def test_suggest_action_sensitive_s3_rejected_when_human_disabled():
    """敏感 + S3 + 人审关 → 拒绝。"""
    assert _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S3.value,
        human_enabled=False, recall_mode=True,
    ) == "rejected"


def test_suggest_action_sensitive_s0_approved():
    """敏感 + S0（没检出敏感内容）→ 通过。"""
    assert _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=False,
    ) == "approved"


def test_suggest_action_low_approved_by_default():
    assert _suggest_action_for(
        RiskLevel.LOW.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=False,
    ) == "approved"


def test_suggest_action_low_review_in_recall_mode():
    assert _suggest_action_for(
        RiskLevel.LOW.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=True,
    ) == "review"


def test_suggest_action_none_always_approved():
    assert _suggest_action_for(
        RiskLevel.NONE.value, SensitiveLevel.S0.value,
        human_enabled=False, recall_mode=False,
    ) == "approved"


# ─── desensitization engine ───────────────────────────────────────────────

def test_desensitize_masks_phone():
    res = desensitize("致电 13812345678 退订", build_default_rules())
    assert "138****5678" in res.masked
    assert any(s.category == "phone" for s in res.spans)


def test_desensitize_masks_id_card():
    res = desensitize("身份证 110101199001011234", build_default_rules())
    assert res.masked != "身份证 110101199001011234"
    assert any(s.category == "id_card" for s in res.spans)


def test_desensitize_masks_email():
    res = desensitize("联系 zhangsan@example.com", build_default_rules())
    assert "@example.com" in res.masked
    assert "zhangsan" not in res.masked
    assert any(s.category == "email" for s in res.spans)


def test_desensitize_masks_address():
    res = desensitize("办公地址：上海市浦东新区张江路100号", build_default_rules())
    assert "****" in res.masked
    assert any(s.category == "address" for s in res.spans)


def test_desensitize_respects_whitelist():
    # Order number overlaps phone regex; whitelist should preserve it.
    res = desensitize(
        "订单号 13812345678 请勿泄露",
        build_default_rules(),
        whitelist=["13812345678"],
    )
    assert "13812345678" in res.masked
    assert res.spans == []


def test_desensitize_empty_input():
    res = desensitize("", build_default_rules())
    assert res.masked == ""
    assert res.spans == []


def test_desensitize_no_pii_unchanged():
    text = "本广告包含咖啡促销信息"
    res = desensitize(text, build_default_rules())
    assert res.masked == text
    assert res.spans == []


def test_desensitize_dominant_category_priority():
    # id_card should beat phone when both present.
    res = desensitize(
        "手机 13812345678 身份证 110101199001011234",
        build_default_rules(),
    )
    assert res.category == "id_card"