"""敏感等级 (SensitiveLevel) — 机审 hit 上的 PII 严重度.

四档（S0/S1/S2/S3），数字越大敏感程度越高：

- S0: 未检出敏感内容
- S1: 轻度敏感（行业内的常规 PII，如手机号、地址）
- S2: 中度敏感（接近违规线的表述）
- S3: 重度敏感（明显违规：涉政、暴恐、明确违规医疗/金融话术）

注意：SensitiveLevel 与 RiskLevel 是**正交**的两条线：

- RiskLevel（高/中/低/敏感/无）→ 决定**素材的整体动作**
- SensitiveLevel（S0~S3）→ 决定**敏感内容本身的细粒度严重度**

仅当 risk_level == "敏感" 时，hit 才会携带 sensitive_grade 字段。
其他 risk_level 档位下默认为 S0，不参与决策。
"""
from __future__ import annotations

import enum


class SensitiveLevel(str, enum.Enum):
    """机审 hit 携带的 PII 严重度（S0~S3，数字越大越严重）。"""

    S0 = "S0"   # 未检出敏感内容
    S1 = "S1"   # 轻度敏感
    S2 = "S2"   # 中度敏感
    S3 = "S3"   # 重度敏感


# 排序权重：用于 max 汇总（"严重度最高原则"）
SENSITIVE_LEVEL_RANK: dict[SensitiveLevel, int] = {
    SensitiveLevel.S0: 0,
    SensitiveLevel.S1: 1,
    SensitiveLevel.S2: 2,
    SensitiveLevel.S3: 3,
}


def sensitive_level_rank(level: SensitiveLevel | str | None) -> int:
    """返回等级的排序权重。未知值视为 S0。"""
    if level is None:
        return 0
    if isinstance(level, SensitiveLevel):
        return SENSITIVE_LEVEL_RANK.get(level, 0)
    # 字符串回退
    try:
        return SENSITIVE_LEVEL_RANK.get(SensitiveLevel(level), 0)
    except ValueError:
        return 0
