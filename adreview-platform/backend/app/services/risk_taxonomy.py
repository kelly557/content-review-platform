"""Risk taxonomy: 结构化的 hit -> risk_level 映射.

替代旧版 aggregate_risk_level 中脆弱的 label_cn 关键字 substring 匹配。

判定顺序 (v2):
  1) LLM 给的 hit.risk 字段 (在 LABEL_RISK_VALUES 内)  -> 直接采用
  2) LABEL_RISK_MAP[(service_code, label_prefix)] 查表   -> 命中即采用
  3) keyword_risk_fallback(label_cn)                  -> 关键字兜底
  4) 默认 "低风险"
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional

from app.models.human_review_config import RiskLevel

VALID_RISK_VALUES: frozenset[str] = frozenset({
    RiskLevel.HIGH.value,
    RiskLevel.MEDIUM.value,
    RiskLevel.SENSITIVE.value,
    RiskLevel.LOW.value,
    RiskLevel.NONE.value,
})

_RISK_RANK: dict[str, int] = {
    RiskLevel.HIGH.value: 4,
    RiskLevel.MEDIUM.value: 3,
    RiskLevel.SENSITIVE.value: 2,
    RiskLevel.LOW.value: 1,
    RiskLevel.NONE.value: 0,
}


# (service_code, label_prefix) -> risk_level
# label_prefix 走 startswith 匹配 (case-insensitive), 允许业务侧用
# `politics_*` / `abuse_*` 等命名空间。
LABEL_RISK_MAP: dict[tuple[str, str], str] = {
    # ── text_detection_pro ──
    ("text_detection_pro", "politics"): RiskLevel.HIGH.value,
    ("text_detection_pro", "political"): RiskLevel.HIGH.value,
    ("text_detection_pro", "medical"): RiskLevel.HIGH.value,
    ("text_detection_pro", "absolute_claim"): RiskLevel.HIGH.value,
    ("text_detection_pro", "illegal"): RiskLevel.HIGH.value,
    ("text_detection_pro", "violence"): RiskLevel.HIGH.value,
    ("text_detection_pro", "minor"): RiskLevel.HIGH.value,
    ("text_detection_pro", "discrimination"): RiskLevel.HIGH.value,
    ("text_detection_pro", "tobacco"): RiskLevel.HIGH.value,
    ("text_detection_pro", "alcohol"): RiskLevel.MEDIUM.value,
    ("text_detection_pro", "abuse"): RiskLevel.MEDIUM.value,
    ("text_detection_pro", "profanity"): RiskLevel.MEDIUM.value,
    ("text_detection_pro", "pii"): RiskLevel.SENSITIVE.value,
    ("text_detection_pro", "pii_id_card"): RiskLevel.SENSITIVE.value,
    ("text_detection_pro", "pii_phone"): RiskLevel.SENSITIVE.value,
    ("text_detection_pro", "pii_address"): RiskLevel.SENSITIVE.value,
    ("text_detection_pro", "ad_compliance"): RiskLevel.MEDIUM.value,
    # ── image_audit_pro ──
    ("image_audit_pro", "politics"): RiskLevel.HIGH.value,
    ("image_audit_pro", "medical"): RiskLevel.HIGH.value,
    ("image_audit_pro", "violence"): RiskLevel.HIGH.value,
    ("image_audit_pro", "porn"): RiskLevel.HIGH.value,
    ("image_audit_pro", "minor"): RiskLevel.HIGH.value,
    ("image_audit_pro", "terrorism"): RiskLevel.HIGH.value,
    # ── audio_audit_pro ──
    ("audio_audit_pro", "politics"): RiskLevel.HIGH.value,
    ("audio_audit_pro", "abuse"): RiskLevel.MEDIUM.value,
    # ── document_audit_pro ──
    ("document_audit_pro", "politics"): RiskLevel.HIGH.value,
    ("document_audit_pro", "medical"): RiskLevel.HIGH.value,
    ("document_audit_pro", "pii"): RiskLevel.SENSITIVE.value,
    # ── video_audit_pro ──
    ("video_audit_pro", "politics"): RiskLevel.HIGH.value,
    ("video_audit_pro", "violence"): RiskLevel.HIGH.value,
    ("video_audit_pro", "porn"): RiskLevel.HIGH.value,
    ("video_audit_pro", "terrorism"): RiskLevel.HIGH.value,
}

# label_cn 关键字兜底 (顺序无关, 命中即返回).
# 比旧版的 "医疗/政治/金融/敏感" 更广, 覆盖 LLM 输出的常见变体.
_KEYWORD_HIGH: tuple[str, ...] = (
    "政治", "涉政", "反动", "暴力", "血腥", "恐怖", "色情", "低俗",
    "医疗", "药品", "医疗广告", "医疗效果", "绝对化", "极限词", "第一",
    "未成年", "儿童", "烟草", "烟", "毒品", "赌", "博彩",
    "歧视", "辱骂", "宗教", "邪教", "民族", "性别歧视",
    "传销", "诈骗", "违法", "违规", "违禁",
)
_KEYWORD_MEDIUM: tuple[str, ...] = (
    "金融", "贷款", "信用卡", "投资", "理财", "股票", "基金", "保险",
    "广告", "广告法", "功效", "承诺", "保证", "夸大",
    "烟酒", "酒精", "酒类", "医美", "美容",
    "成人", "暗示", "性感",
)
_KEYWORD_SENSITIVE: tuple[str, ...] = (
    "敏感", "隐私", "个人信息", "身份证", "手机号", "住址", "邮箱",
    "银行卡", "账号", "密码",
)


def _norm_label(label: str) -> str:
    return (label or "").strip().lower()


def label_risk_lookup(service_code: str, label: str) -> Optional[str]:
    """查 LABEL_RISK_MAP. label 走 startswith 匹配 (case-insensitive)."""
    if not service_code or not label:
        return None
    norm_label = _norm_label(label)
    norm_service = service_code.strip()
    for (svc, prefix), risk in LABEL_RISK_MAP.items():
        if svc != norm_service:
            continue
        if norm_label == prefix or norm_label.startswith(prefix):
            return risk
    return None


def keyword_risk_fallback(label_cn: str) -> Optional[str]:
    """label_cn 关键字兜底: 返回最高匹配的 risk, 无命中返回 None."""
    if not label_cn:
        return None
    for kw in _KEYWORD_HIGH:
        if kw in label_cn:
            return RiskLevel.HIGH.value
    for kw in _KEYWORD_MEDIUM:
        if kw in label_cn:
            return RiskLevel.MEDIUM.value
    for kw in _KEYWORD_SENSITIVE:
        if kw in label_cn:
            return RiskLevel.SENSITIVE.value
    return None


def _hit_risk_from_llm(hit: Mapping[str, Any]) -> Optional[str]:
    raw = (hit.get("risk") or "").strip()
    return raw if raw in VALID_RISK_VALUES else None


def _hit_risk(
    hit: Mapping[str, Any],
    *,
    default: str = RiskLevel.LOW.value,
) -> str:
    """单 hit -> risk 字符串. 来源优先级: LLM risk > 查表 > 关键字 > default."""
    llm_risk = _hit_risk_from_llm(hit)
    if llm_risk:
        return llm_risk
    table_risk = label_risk_lookup(
        str(hit.get("service_code") or ""),
        str(hit.get("label") or ""),
    )
    if table_risk:
        return table_risk
    kw_risk = keyword_risk_fallback(str(hit.get("label_cn") or ""))
    if kw_risk:
        return kw_risk
    return default


def aggregate_risk_level_v2(hits: Iterable[Mapping[str, Any]]) -> str:
    """聚合素材级 risk_level.

    与 v1 不同:
    - 不再用 label_cn substring 猜——先信 LLM risk, 再查静态表, 再走扩展关键字
    - 无命中返回 "无风险"
    """
    max_rank = -1
    best = RiskLevel.NONE.value
    for hit in hits:
        risk = _hit_risk(hit)
        rank = _RISK_RANK.get(risk, _RISK_RANK[RiskLevel.LOW.value])
        if rank > max_rank:
            max_rank = rank
            best = risk
    if max_rank < 0:
        return RiskLevel.NONE.value
    return best


def risk_rank(value: str) -> int:
    """暴露给上游 (例如 _suggest_action_for) 的 risk 排名, 便于做更高层决策."""
    return _RISK_RANK.get(value, -1)
