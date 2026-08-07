"""SensitiveLevel 字段约束测试 (v3).

确认机器审核落库前, sensitive_grade / sensitive_level 不会被跨档污染.
"""
from __future__ import annotations

import app.models  # noqa: F401
from app.models.sensitive_level import SensitiveLevel
from app.tasks.machine_review import aggregate_sensitive_level


def test_aggregate_keeps_pii_max_when_no_risk_field():
    """当 hit 上缺 risk 字段 (老路径未升级) 时, 维持旧的 max 汇总."""
    hits = [
        {"sensitive_grade": "S1"},
        {"sensitive_grade": "S3"},
        {"sensitive_grade": "S0"},
    ]
    assert aggregate_sensitive_level(hits) == "S3"


def test_aggregate_drops_grade_when_hit_is_high_risk():
    """当某条 hit 已标 risk=高风险, 其 sensitive_grade 必须被强制 S0."""
    hits = [
        {"risk": "高风险", "sensitive_grade": "S3"},
        {"sensitive_grade": "S1"},  # 无 risk 上下文, 保留
    ]
    out = aggregate_sensitive_level(hits)
    # max: S3 hit 被 coerce 成 S0, S1 hit 保留, 结果是 S1
    assert out == "S1"
    assert hits[0]["sensitive_grade"] == "S0"
    assert hits[0]["sensitive_was_coerced"] is True


def test_aggregate_keeps_grade_when_hit_is_sensitive_risk():
    """当某条 hit 风险档为"敏感", sensitive_grade 走 max 汇总."""
    hits = [
        {"risk": "敏感", "sensitive_grade": "S2"},
        {"risk": "敏感", "sensitive_grade": "S3"},
    ]
    out = aggregate_sensitive_level(hits)
    assert out == "S3"


def test_aggregate_risk_level_field_supported():
    hits = [
        {"risk_level": "中风险", "sensitive_grade": "S3"},
    ]
    out = aggregate_sensitive_level(hits)
    assert out == "S0"
    assert hits[0]["sensitive_grade"] == "S0"


def test_aggregate_mixed_risks_top_down():
    hits = [
        {"risk": "高风险", "sensitive_grade": "S3"},   # coerce -> S0
        {"risk": "敏感", "sensitive_grade": "S2"},      # 保留
        {"risk": "中风险", "sensitive_grade": "S3"},    # coerce -> S0
        {"risk": "敏感", "sensitive_grade": "S3"},      # 保留
    ]
    out = aggregate_sensitive_level(hits)
    assert out == "S3"
    assert hits[0]["sensitive_grade"] == "S0"
    assert hits[1]["sensitive_grade"] == "S2"
    assert hits[2]["sensitive_grade"] == "S0"
    assert hits[3]["sensitive_grade"] == "S3"


def test_enum_string_inputs_unchanged_behavior():
    """不破坏 SensitiveLevel 枚举输入路径."""
    hits = [
        {"risk": "敏感", "sensitive_grade": SensitiveLevel.S2},
        {"sensitive_grade": SensitiveLevel.S1},  # 无 risk, 保留
    ]
    out = aggregate_sensitive_level(hits)
    assert out == "S2"
