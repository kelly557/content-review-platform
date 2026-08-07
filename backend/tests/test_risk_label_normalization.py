"""字段收敛测试 (v3): "敏感" 档只承载 PII.

覆盖:
- normalize_label_cn 高/中风险剔除"敏感"字
- normalize_label_cn 敏感档保留
- coerce_sensitive_grade_for_hit 在 per-hit risk ≠ 敏感时强制 S0
- coerce_sensitive_grade_for_hit 在 per-hit risk == 敏感时保留
- coerce_sensitive_grade_for_hit 在缺失 risk 上下文时不写回
- aggregate_risk_level_v2 副作用: 写 hit.risk / 洗 label_cn / coerce grade
- 多 hit 聚合: 高风险 hit 强制 S0, 敏感 hit 保留 S3
"""
from __future__ import annotations

import app.models  # noqa: F401
from app.models.human_review_config import RiskLevel
from app.services.risk_taxonomy import (
    aggregate_risk_level_v2,
    coerce_sensitive_grade_for_hit,
    normalize_label_cn,
)


# ─── normalize_label_cn ────────────────────────────────────────────


def test_normalize_strips_sensitive_token_under_high_risk():
    assert normalize_label_cn(RiskLevel.HIGH.value, "涉政敏感") == "涉政"
    assert normalize_label_cn(RiskLevel.HIGH.value, "涉政敏感词汇") == "涉政词汇"
    assert normalize_label_cn(RiskLevel.HIGH.value, "敏感涉政敏感") == "涉政"


def test_normalize_strips_sensitive_token_under_medium_risk():
    assert normalize_label_cn(RiskLevel.MEDIUM.value, "广告法敏感") == "广告法"


def test_normalize_preserves_under_sensitive_risk():
    assert normalize_label_cn(RiskLevel.SENSITIVE.value, "敏感个人信息") == "敏感个人信息"
    assert normalize_label_cn(RiskLevel.SENSITIVE.value, "涉政敏感") == "涉政敏感"
    assert normalize_label_cn(RiskLevel.SENSITIVE.value, "身份证命中") == "身份证命中"


def test_normalize_passthrough_under_low_and_none():
    assert normalize_label_cn(RiskLevel.LOW.value, "敏感话题") == "敏感话题"
    assert normalize_label_cn(RiskLevel.NONE.value, "敏感话题") == "敏感话题"


def test_normalize_empty_or_none():
    assert normalize_label_cn(RiskLevel.HIGH.value, "") == ""
    assert normalize_label_cn(RiskLevel.HIGH.value, None) == ""
    assert normalize_label_cn("", "敏感涉政") == "敏感涉政"


# ─── coerce_sensitive_grade_for_hit ────────────────────────────────


def test_coerce_strips_grade_when_risk_is_high():
    hit = {"risk": RiskLevel.HIGH.value, "sensitive_grade": "S3", "sensitive_level": "S3"}
    coerce_sensitive_grade_for_hit(hit)
    assert hit["sensitive_grade"] == "S0"
    assert hit["sensitive_level"] == "S0"
    assert hit["sensitive_was_coerced"] is True


def test_coerce_strips_grade_when_risk_level_field_used():
    hit = {"risk_level": RiskLevel.MEDIUM.value, "sensitive_grade": "S2"}
    coerce_sensitive_grade_for_hit(hit)
    assert hit["sensitive_grade"] == "S0"


def test_coerce_preserves_when_risk_is_sensitive():
    hit = {"risk": RiskLevel.SENSITIVE.value, "sensitive_grade": "S3"}
    coerce_sensitive_grade_for_hit(hit)
    assert hit["sensitive_grade"] == "S3"
    assert "sensitive_was_coerced" not in hit


def test_coerce_no_op_without_risk_context():
    hit = {"sensitive_grade": "S3"}  # 没 risk / risk_level
    coerce_sensitive_grade_for_hit(hit)
    assert hit["sensitive_grade"] == "S3"
    assert "sensitive_was_coerced" not in hit


def test_coerce_skips_already_zero():
    hit = {"risk": RiskLevel.HIGH.value, "sensitive_grade": "S0", "sensitive_level": "S0"}
    coerce_sensitive_grade_for_hit(hit)
    assert "sensitive_was_coerced" not in hit


def test_coerce_skips_immutable_mapping():
    from types import MappingProxyType

    hit = MappingProxyType({"risk": RiskLevel.HIGH.value, "sensitive_grade": "S3"})
    coerce_sensitive_grade_for_hit(hit)  # 不应抛
    assert hit["sensitive_grade"] == "S3"


# ─── aggregate_risk_level_v2 副作用 ────────────────────────────────


def test_aggregate_writes_hit_risk_and_normalizes_label():
    hits = [
        {"label_cn": "涉政敏感", "service_code": "text_detection_pro"},
    ]
    risk = aggregate_risk_level_v2(hits)
    assert risk == RiskLevel.HIGH.value
    assert hits[0]["risk"] == RiskLevel.HIGH.value
    assert hits[0]["label_cn"] == "涉政"


def test_aggregate_coerces_grade_for_non_sensitive_hits():
    hits = [
        {
            "label_cn": "涉政言论",
            "service_code": "text_detection_pro",
            "sensitive_grade": "S3",
        },
    ]
    risk = aggregate_risk_level_v2(hits)
    assert risk == RiskLevel.HIGH.value
    assert hits[0]["sensitive_grade"] == "S0"
    assert hits[0]["sensitive_was_coerced"] is True


def test_aggregate_preserves_sensitive_grade_under_sensitive_risk():
    hits = [
        {
            "label": "pii_id_card",
            "service_code": "text_detection_pro",
            "sensitive_grade": "S3",
        },
    ]
    risk = aggregate_risk_level_v2(hits)
    assert risk == RiskLevel.SENSITIVE.value
    assert hits[0]["sensitive_grade"] == "S3"


def test_aggregate_high_risk_coexists_with_sensitive_hit():
    """高风险 hit 强制 S0, 敏感 hit 保留 S3; 整体 risk 取最高."""
    hits = [
        {
            "label_cn": "涉政敏感",
            "service_code": "text_detection_pro",
            "sensitive_grade": "S3",
        },
        {
            "label": "pii_id_card",
            "service_code": "text_detection_pro",
            "sensitive_grade": "S2",
        },
    ]
    risk = aggregate_risk_level_v2(hits)
    assert risk == RiskLevel.HIGH.value
    # 政治 hit 被 coerce, PII hit 保留
    assert hits[0]["sensitive_grade"] == "S0"
    assert hits[0]["label_cn"] == "涉政"
    assert hits[1]["sensitive_grade"] == "S2"


def test_aggregate_top_leader_returns_high_risk_only():
    hits = [
        {
            "label_cn": "国家主席相关涉政敏感",
            "service_code": "text_detection_pro",
            "sensitive_grade": "S3",
        },
    ]
    risk = aggregate_risk_level_v2(hits)
    assert risk == RiskLevel.HIGH.value
    assert hits[0]["label_cn"] == "国家主席相关涉政"
    assert hits[0]["sensitive_grade"] == "S0"
