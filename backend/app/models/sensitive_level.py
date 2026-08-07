"""敏感等级 (SensitiveLevel) — "敏感"档内 hit 的 PII 严重度.

四档（S0/S1/S2/S3），数字越大敏感程度越高：

- S0: 未检出敏感内容
- S1: 轻度敏感（行业内的常规 PII：手机号、地址）
- S2: 中度敏感（接近违规线的 PII 组合：身份证 + 姓名）
- S3: 重度敏感（多维 PII 共现：身份证 + 银行卡 + 手机号）

口径收紧 (2026-07-13):
- "敏感" 档位 **只承载 PII**；涉政、暴恐、医疗违规等不再以 S3 表达.
- 涉政/暴恐等语义走 RiskLevel.HIGH, 不会落入 "敏感" 档.
- SensitiveLevel 与 RiskLevel **正交但有约束**:
    * RiskLevel（高/中/低/敏感/无）→ 决定**素材的整体动作**
    * SensitiveLevel（S0~S3）        → 决定**"敏感"档内** PII 严重度
- 仅当 risk_level == "敏感" 时, hit 才会携带 non-zero sensitive_grade.
  其他 risk_level 档位下默认 S0, 并由 risk_taxonomy.coerce_sensitive_grade_for_hit
  强制回写 (避免演示数据跨档挂高 S 等级).
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
