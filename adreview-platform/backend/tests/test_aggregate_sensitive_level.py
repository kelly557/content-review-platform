"""机审 hit 级别 sensitive_grade 汇总为素材级 SensitiveLevel。

按 max（"严重度最高原则"）汇总。
"""
from __future__ import annotations

from app.models.sensitive_level import (
    SENSITIVE_LEVEL_RANK,
    SensitiveLevel,
    sensitive_level_rank,
)
from app.tasks.machine_review import aggregate_sensitive_level


def test_rank_ordering():
    """S3 > S2 > S1 > S0。"""
    assert sensitive_level_rank(SensitiveLevel.S3) > sensitive_level_rank(SensitiveLevel.S2)
    assert sensitive_level_rank(SensitiveLevel.S2) > sensitive_level_rank(SensitiveLevel.S1)
    assert sensitive_level_rank(SensitiveLevel.S1) > sensitive_level_rank(SensitiveLevel.S0)
    assert sensitive_level_rank(SensitiveLevel.S0) == 0


def test_rank_string_fallback():
    """字符串回退：传 "S2" 等同 SensitiveLevel.S2。"""
    assert sensitive_level_rank("S3") == 3
    assert sensitive_level_rank("S1") == 1
    assert sensitive_level_rank("S0") == 0
    # 未知值回退到 0
    assert sensitive_level_rank("S9") == 0
    assert sensitive_level_rank(None) == 0


def test_aggregate_empty_hits():
    """无命中 → S0。"""
    assert aggregate_sensitive_level([]) == SensitiveLevel.S0.value


def test_aggregate_no_sensitive_field():
    """命中不含 sensitive_grade → S0。"""
    hits = [
        {"label_cn": "医疗广告违规", "risk": "高风险"},
        {"label_cn": "敏感内容", "risk": "敏感"},
    ]
    assert aggregate_sensitive_level(hits) == SensitiveLevel.S0.value


def test_aggregate_max_s1():
    """所有命中都是 S1 → S1。"""
    hits = [
        {"label_cn": "敏感内容A", "sensitive_grade": "S1"},
        {"label_cn": "敏感内容B", "sensitive_grade": "S1"},
    ]
    assert aggregate_sensitive_level(hits) == SensitiveLevel.S1.value


def test_aggregate_max_s2_over_s1():
    """S2 + S1 → S2。"""
    hits = [
        {"label_cn": "金融", "sensitive_grade": "S2"},
        {"label_cn": "敏感内容", "sensitive_grade": "S1"},
    ]
    assert aggregate_sensitive_level(hits) == SensitiveLevel.S2.value


def test_aggregate_max_s3_dominates():
    """S3 + 任意其他 → S3。"""
    hits = [
        {"label_cn": "医疗", "sensitive_grade": "S3"},
        {"label_cn": "金融", "sensitive_grade": "S2"},
        {"label_cn": "敏感", "sensitive_grade": "S1"},
        {"label_cn": "正常", "sensitive_grade": "S0"},
    ]
    assert aggregate_sensitive_level(hits) == SensitiveLevel.S3.value


def test_aggregate_mixed_with_s0():
    """S1 + S0 → S1。"""
    hits = [
        {"label_cn": "敏感内容", "sensitive_grade": "S1"},
        {"label_cn": "正常", "sensitive_grade": "S0"},
    ]
    assert aggregate_sensitive_level(hits) == SensitiveLevel.S1.value


def test_aggregate_enum_input():
    """直接传 SensitiveLevel 枚举（不仅是 str）。"""
    hits = [
        {"label_cn": "金融", "sensitive_grade": SensitiveLevel.S2},
        {"label_cn": "敏感", "sensitive_grade": SensitiveLevel.S1},
    ]
    assert aggregate_sensitive_level(hits) == SensitiveLevel.S2.value


def test_rank_dict_consistency():
    """SENSITIVE_LEVEL_RANK 字典与枚举值一致。"""
    for level in SensitiveLevel:
        assert SENSITIVE_LEVEL_RANK[level] == sensitive_level_rank(level)
