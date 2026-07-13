"""machine_review 内部函数 + LLM hit 透传测试 (纯函数, 无 DB 依赖)."""
from __future__ import annotations

from types import SimpleNamespace

import app.models  # noqa: F401
from app.tasks.machine_review import (
    _build_rule_hits,
    _result_to_hits,
)


def _llm_hit(**over):
    base = {
        "service_code": "text_detection_pro",
        "service_name": "通用文本审核",
        "label": "politics_event",
        "label_cn": "涉政敏感",
        "score": 0.9,
        "quote": "涉政黑名单",
        "sensitive_grade": "S0",
        "risk": "高风险",
    }
    base.update(over)
    return SimpleNamespace(**base)


def test_result_to_hits_passes_through_risk():
    """LLM hit.risk 必须透传到内部 hit dict."""
    result = SimpleNamespace(hits=[_llm_hit(risk="中风险")])
    hits = _result_to_hits(result, ["text_detection_pro"])
    assert len(hits) == 1
    assert hits[0]["risk"] == "中风险"
    assert hits[0]["source"] == "llm"


def test_result_to_hits_risk_normalized_to_none_on_empty():
    result = SimpleNamespace(hits=[_llm_hit(risk="")])
    hits = _result_to_hits(result, ["text_detection_pro"])
    assert hits[0]["risk"] is None


def test_result_to_hits_score_clamped():
    result = SimpleNamespace(hits=[_llm_hit(score=1.5)])
    hits = _result_to_hits(result, ["text_detection_pro"])
    assert hits[0]["score"] == 1.0

    result = SimpleNamespace(hits=[_llm_hit(score=-0.5)])
    hits = _result_to_hits(result, ["text_detection_pro"])
    assert hits[0]["score"] == 0.0


def test_build_rule_hits_carries_source_field():
    hits = [
        {
            "label": "politics",
            "label_cn": "涉政",
            "sensitive_grade": "S0",
            "source": "llm",
        },
        {
            "label": "local_wordset_1",
            "label_cn": "自定义黑名单:骂",
            "sensitive_grade": "S0",
            "source": "local_wordset",
        },
    ]
    rule_hits = _build_rule_hits(hits)
    assert len(rule_hits) == 2
    sources = {r["source"] for r in rule_hits}
    assert sources == {"llm", "local_wordset"}


def test_build_rule_hits_dedupes_by_label():
    hits = [
        {"label": "dup", "label_cn": "X", "sensitive_grade": "S0", "source": "llm"},
        {"label": "dup", "label_cn": "X", "sensitive_grade": "S0", "source": "llm"},
    ]
    assert len(_build_rule_hits(hits)) == 1


def test_combined_local_and_llm_hits_aggregate_to_high_risk():
    """端到端: 本地黑名单 '骂' 命中 + LLM 涉政词命中 → 整体 高风险."""
    from app.tasks.machine_review import aggregate_risk_level

    hits = [
        {
            "service_code": "local_wordset",
            "label": "local_wordset_1",
            "label_cn": "自定义黑名单:骂",
            "risk": "高风险",
            "source": "local_wordset",
        },
        {
            "service_code": "text_detection_pro",
            "label": "politics_event",
            "label_cn": "涉政敏感",
            "risk": "高风险",
            "source": "llm",
        },
    ]
    assert aggregate_risk_level(hits) == "高风险"
