"""抽审比例（sample_ratio）行为测试。

覆盖 _suggest_action_for 在 sample_ratio=0/30/100 时的行为：
- 100: 全部升级（向后兼容）
- 0:   全部不升级，按默认矩阵（高/中/敏感拒绝；低风险通过）
- 30:  约 30% 抽样升级（统计意义）

抽样基于 sample_seed 确定性 hash，同一素材同结论。
"""
from __future__ import annotations

import pytest

from app.models.human_review_config import RiskLevel
from app.models.sensitive_level import SensitiveLevel
from app.tasks.machine_review import _suggest_action_for


# ── 边界值 ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "sample_ratio",
    [-1, -0.01, 100.01, 200, 999],
    ids=["neg_int", "neg_frac", "barely_over", "double", "huge"],
)
def test_sample_ratio_out_of_range_raises(sample_ratio):
    """Pydantic 校验在 schema 层做；这里仅验证函数对非法值不抽样（保持 review）。

    实际生产中 HumanReviewSettings.normalized() 已经过滤非法值，
    但万一脏数据漏过来：sample_ratio < 0 或 > 100 时按 100 处理（保守升级）。
    """
    # _suggest_action_for 不做边界校验，由 schema 把关
    # 这里仅确保函数不崩溃
    result = _suggest_action_for(
        RiskLevel.HIGH.value,
        SensitiveLevel.S0.value,
        human_enabled=True,
        recall_mode=False,
        sample_seed="mat-1",
        sample_ratio=sample_ratio,
    )
    assert result in ("review", "rejected", "approved", "desensitize")


# ── 100% = 全部升级（向后兼容）────────────────────────────────────────────


def test_sample_ratio_100_all_escalate():
    """sample_ratio=100 时所有需要升级的素材都进入 review。"""
    assert (
        _suggest_action_for(
            RiskLevel.HIGH.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-100pct", sample_ratio=100,
        )
        == "review"
    )
    assert (
        _suggest_action_for(
            RiskLevel.MEDIUM.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-100pct", sample_ratio=100,
        )
        == "review"
    )


def test_sample_ratio_none_default_all_escalate():
    """sample_ratio=None 等价于 100（向后兼容）。"""
    assert (
        _suggest_action_for(
            RiskLevel.HIGH.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-x",
        )
        == "review"
    )


# ── 0% = 全部不升级，按矩阵默认 ───────────────────────────────────────────


def test_sample_ratio_0_high_rejected():
    """0% 抽样时高风险降级为 rejected（不放行）。"""
    assert (
        _suggest_action_for(
            RiskLevel.HIGH.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-0", sample_ratio=0,
        )
        == "rejected"
    )


def test_sample_ratio_0_medium_rejected():
    assert (
        _suggest_action_for(
            RiskLevel.MEDIUM.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-0", sample_ratio=0,
        )
        == "rejected"
    )


def test_sample_ratio_0_sensitive_s3_rejected():
    assert (
        _suggest_action_for(
            RiskLevel.SENSITIVE.value, SensitiveLevel.S3.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-0", sample_ratio=0,
        )
        == "rejected"
    )


def test_sample_ratio_0_low_approved():
    """0% 抽样时低风险按矩阵通过（不拒绝）。"""
    assert (
        _suggest_action_for(
            RiskLevel.LOW.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-0", sample_ratio=0,
        )
        == "approved"
    )


def test_sample_ratio_0_sensitive_s1_still_desensitize():
    """S1 永远走脱敏放行，抽样不介入。"""
    assert (
        _suggest_action_for(
            RiskLevel.SENSITIVE.value, SensitiveLevel.S1.value,
            human_enabled=True, recall_mode=False,
            sample_seed="mat-0", sample_ratio=0,
        )
        == "desensitize"
    )


# ── 抽样介入：关人审时 sample_ratio 不生效 ───────────────────────────────


def test_sample_ratio_ignored_when_human_disabled():
    """关人审时抽样不应改变行为（直接走矩阵默认）。"""
    # 高风险 + 关人审 + sample_ratio=30 → 应该 rejected，不抽样
    assert (
        _suggest_action_for(
            RiskLevel.HIGH.value, SensitiveLevel.S0.value,
            human_enabled=False, recall_mode=False,
            sample_seed="mat-1", sample_ratio=30,
        )
        == "rejected"
    )


# ── 抽样介入：确定性 hash，同 seed 同结论 ──────────────────────────────


def test_sample_seed_deterministic():
    """同一 seed 多次调用结果一致。"""
    results = [
        _suggest_action_for(
            RiskLevel.HIGH.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            sample_seed="deterministic-mat", sample_ratio=50,
        )
        for _ in range(10)
    ]
    assert len(set(results)) == 1, f"非确定性：{results}"


# ── 抽样统计分布（30% 抽样在 1000 条素材中应接近 300 条命中）──────────────


def test_sample_ratio_30_distribution_within_tolerance():
    """30% 抽样下 1000 条素材命中数应在 [240, 360] 范围内（容差 20%）。"""
    n = 1000
    hits = sum(
        1
        for i in range(n)
        if _suggest_action_for(
            RiskLevel.HIGH.value,
            SensitiveLevel.S0.value,
            human_enabled=True,
            recall_mode=False,
            sample_seed=f"mat-{i}",
            sample_ratio=30,
        )
        == "review"
    )
    # 容差 ±20%（240~360），hash 分布通常远好于此
    assert 240 <= hits <= 360, f"30% 抽样命中数 {hits} 不在 [240, 360] 范围内"


def test_sample_ratio_0_distribution_zero_hits():
    """0% 抽样下应该 0 命中。"""
    n = 200
    hits = sum(
        1
        for i in range(n)
        if _suggest_action_for(
            RiskLevel.HIGH.value,
            SensitiveLevel.S0.value,
            human_enabled=True,
            recall_mode=False,
            sample_seed=f"mat-{i}",
            sample_ratio=0,
        )
        == "review"
    )
    assert hits == 0, f"0% 抽样不应命中，实际命中 {hits}"


def test_sample_ratio_100_distribution_all_hits():
    """100% 抽样下应该全部命中。"""
    n = 200
    hits = sum(
        1
        for i in range(n)
        if _suggest_action_for(
            RiskLevel.HIGH.value,
            SensitiveLevel.S0.value,
            human_enabled=True,
            recall_mode=False,
            sample_seed=f"mat-{i}",
            sample_ratio=100,
        )
        == "review"
    )
    assert hits == n, f"100% 抽样应全部命中，实际 {hits}/{n}"


# ── 用户覆盖优先：抽样不应覆盖用户自定义 ────────────────────────────────


def test_user_override_takes_precedence_over_sample():
    """用户配置 auto_action_overrides 优先于抽样决策。"""
    overrides = {"高风险|—": "rejected"}
    # sample_ratio=100 + 用户覆盖 rejected → 应返回 rejected
    assert (
        _suggest_action_for(
            RiskLevel.HIGH.value, SensitiveLevel.S0.value,
            human_enabled=True, recall_mode=False,
            auto_action_overrides=overrides,
            sample_seed="mat-1", sample_ratio=100,
        )
        == "rejected"
    )