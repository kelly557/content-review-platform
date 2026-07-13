"""风险等级聚合 (v2) 与 LLM hit 字段透传测试.

覆盖:
- aggregate_risk_level_v2 优先级: LLM risk > 查表 > 关键字 > 默认
- 关键字兜底: 涉政敏感/医疗/金融/敏感/辱骂 各档判定
- 查表: (service_code, label_prefix) startswith 匹配
- 空 hits 返 "无风险"
- 边界: 空字符串/None 字段
"""
from __future__ import annotations

import app.models  # noqa: F401
from app.models.human_review_config import RiskLevel
from app.services.risk_taxonomy import (
    VALID_RISK_VALUES,
    aggregate_risk_level_v2,
    keyword_risk_fallback,
    label_risk_lookup,
    risk_rank,
)
from app.tasks.machine_review import aggregate_risk_level


# ─── 关键字兜底 (label_cn 路径) ─────────────────────────────────────────


def test_keyword_fallback_politics_variants():
    assert keyword_risk_fallback("涉政敏感") == RiskLevel.HIGH.value
    assert keyword_risk_fallback("政治倾向") == RiskLevel.HIGH.value
    assert keyword_risk_fallback("涉政言论") == RiskLevel.HIGH.value
    assert keyword_risk_fallback("反动") == RiskLevel.HIGH.value


def test_keyword_fallback_medical_violations():
    assert keyword_risk_fallback("医疗广告违规") == RiskLevel.HIGH.value
    assert keyword_risk_fallback("绝对化宣称") == RiskLevel.HIGH.value
    assert keyword_risk_fallback("医美项目") == RiskLevel.MEDIUM.value


def test_keyword_fallback_finance():
    assert keyword_risk_fallback("金融理财广告") == RiskLevel.MEDIUM.value
    assert keyword_risk_fallback("信用卡申请") == RiskLevel.MEDIUM.value


def test_keyword_fallback_sensitive_pii():
    assert keyword_risk_fallback("命中身份证号") == RiskLevel.SENSITIVE.value
    assert keyword_risk_fallback("手机号泄露") == RiskLevel.SENSITIVE.value


def test_keyword_fallback_abuse():
    assert keyword_risk_fallback("辱骂他人") == RiskLevel.HIGH.value
    assert keyword_risk_fallback("用户辱骂") == RiskLevel.HIGH.value


def test_keyword_fallback_returns_none_for_unknown():
    assert keyword_risk_fallback("无意义的文字") is None
    assert keyword_risk_fallback("") is None


# ─── 查表 (service_code, label_prefix) ─────────────────────────────────


def test_label_lookup_text_detection_politics():
    assert label_risk_lookup("text_detection_pro", "politics_blabla") == RiskLevel.HIGH.value


def test_label_lookup_text_detection_abuse():
    assert label_risk_lookup("text_detection_pro", "abuse") == RiskLevel.MEDIUM.value


def test_label_lookup_image_audit_porn():
    assert label_risk_lookup("image_audit_pro", "porn") == RiskLevel.HIGH.value


def test_label_lookup_unknown_label():
    assert label_risk_lookup("text_detection_pro", "harmless_label") is None
    assert label_risk_lookup("unknown_service", "politics") is None


# ─── aggregate_risk_level_v2 集成 ───────────────────────────────────────


def test_aggregate_empty_returns_none():
    assert aggregate_risk_level_v2([]) == RiskLevel.NONE.value


def test_aggregate_llm_risk_field_takes_precedence():
    """LLM 显式给 risk='无风险' 时, 即便 label_cn 含敏感词, 也信 LLM."""
    hits = [{"label_cn": "涉政敏感", "risk": "无风险", "service_code": "text_detection_pro"}]
    assert aggregate_risk_level_v2(hits) == RiskLevel.NONE.value


def test_aggregate_falls_back_to_table_when_no_risk():
    """无 risk 字段, label 命中查表 → 高风险."""
    hits = [
        {
            "label_cn": "政治不相关",
            "label": "politics_event",
            "service_code": "text_detection_pro",
        }
    ]
    assert aggregate_risk_level_v2(hits) == RiskLevel.HIGH.value


def test_aggregate_falls_back_to_keyword_when_no_label_match():
    """label 不在表中, label_cn 含 '医疗' → 高风险."""
    hits = [
        {
            "label_cn": "医疗美容效果",
            "label": "harmless_label",
            "service_code": "text_detection_pro",
        }
    ]
    assert aggregate_risk_level_v2(hits) == RiskLevel.HIGH.value


def test_aggregate_picks_max_across_hits():
    hits = [
        {"label_cn": "辱骂", "risk": "高风险", "service_code": "text_detection_pro"},
        {"label_cn": "金融广告", "risk": "中风险", "service_code": "text_detection_pro"},
        {"label_cn": "普通命中", "risk": "低风险", "service_code": "text_detection_pro"},
    ]
    assert aggregate_risk_level_v2(hits) == RiskLevel.HIGH.value


def test_aggregate_legacy_politics_label_cn_v2_promotes_to_high():
    """回归: '涉政敏感' 旧版被判为低风险 (substring 不匹配 '政治');
    v2 用扩展关键字后应判为高风险."""
    hits = [
        {
            "label_cn": "文本包含涉政敏感词汇「涉政黑名单」",
            "label": "harmless_label",
            "service_code": "text_detection_pro",
        }
    ]
    assert aggregate_risk_level_v2(hits) == RiskLevel.HIGH.value


def test_aggregate_mixed_sources():
    """本地词库生成的 hit (source=local_wordset) 与 LLM hit 共存."""
    hits = [
        {"label_cn": "广告", "risk": "低风险", "source": "llm"},
        {"label_cn": "自定义黑名单:骂", "risk": "高风险", "source": "local_wordset"},
    ]
    assert aggregate_risk_level_v2(hits) == RiskLevel.HIGH.value


# ─── aggregate_risk_level 旧名兼容 (走 v2) ──────────────────────────────


def test_aggregate_risk_level_legacy_alias_returns_high_for_politics():
    """旧版 aggregate_risk_level 现在委派给 v2, 行为与 v2 一致."""
    hits = [{"label_cn": "涉政敏感", "service_code": "text_detection_pro"}]
    assert aggregate_risk_level(hits) == RiskLevel.HIGH.value


# ─── 辅助函数 ──────────────────────────────────────────────────────────


def test_risk_rank_ordering():
    assert risk_rank(RiskLevel.HIGH.value) > risk_rank(RiskLevel.MEDIUM.value)
    assert risk_rank(RiskLevel.MEDIUM.value) > risk_rank(RiskLevel.SENSITIVE.value)
    assert risk_rank(RiskLevel.SENSITIVE.value) > risk_rank(RiskLevel.LOW.value)
    assert risk_rank(RiskLevel.LOW.value) > risk_rank(RiskLevel.NONE.value)
    assert risk_rank("invalid") == -1


def test_valid_risk_values_complete():
    assert VALID_RISK_VALUES == frozenset({
        "高风险", "中风险", "低风险", "敏感", "无风险"
    })
