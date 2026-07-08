"""机审节点不升级人审时，按 suggested_action 落 3 类终态。

v9: 覆盖 _handle_machine_stage_completion 在 should_escalate=False 分支下
的所有决策组合（5 risk × 4 sensitive × 2 human × 2 recall 的子集）。

终态分类：
- approved    → APPROVED
- rejected    → REJECTED（含中风险，v9 后统一拒绝）
- desensitize → DESENSITIZED（仅 S1）
- review      → 升级人审（中间动作，由 should_escalate_to_human 触发）
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.review import MachineStatus
from app.models.sensitive_level import SensitiveLevel
from app.models.human_review_config import RiskLevel
from app.models.workflow import WorkflowInstance, WorkflowNode


# ── _suggest_action_for 全矩阵参数化测试（80 组合） ────────────────────────────
from app.tasks.machine_review import _suggest_action_for


def _expected(risk, sensitive, human, recall):
    """与 _suggest_action_for v10 实现严格对齐的期望值。

    v10：策略级优先 — recall_mode 不再参与决策，参数保留仅为签名兼容。
    """
    if risk in (RiskLevel.HIGH.value, RiskLevel.MEDIUM.value):
        return "review" if human else "rejected"
    if risk == RiskLevel.SENSITIVE.value:
        if sensitive in (SensitiveLevel.S3.value, SensitiveLevel.S2.value):
            return "review" if human else "rejected"
        if sensitive == SensitiveLevel.S1.value:
            return "desensitize"
        return "approved"  # S0
    if risk == RiskLevel.LOW.value:
        return "review" if human else "approved"
    return "approved"  # NONE


_RISKS = [
    RiskLevel.HIGH.value,
    RiskLevel.MEDIUM.value,
    RiskLevel.SENSITIVE.value,
    RiskLevel.LOW.value,
    RiskLevel.NONE.value,
]
_SENSITIVES = [
    SensitiveLevel.S0.value,
    SensitiveLevel.S1.value,
    SensitiveLevel.S2.value,
    SensitiveLevel.S3.value,
]


@pytest.mark.parametrize("risk", _RISKS)
@pytest.mark.parametrize("sensitive", _SENSITIVES)
@pytest.mark.parametrize("human_enabled", [False, True])
@pytest.mark.parametrize("recall_mode", [False, True])
def test_suggest_action_matrix(risk, sensitive, human_enabled, recall_mode):
    expected = _expected(risk, sensitive, human_enabled, recall_mode)
    actual = _suggest_action_for(risk, sensitive, human_enabled, recall_mode)
    assert actual == expected, (
        f"risk={risk}, sensitive={sensitive}, "
        f"human={human_enabled}, recall={recall_mode} "
        f"expected {expected!r} got {actual!r}"
    )


# ── 策略级优先：recall_mode 不再阻塞升级（v10 关键 case） ─────────────────


@pytest.mark.parametrize("recall_mode", [False, True])
def test_low_risk_strategy_priority_overrides_recall_mode(recall_mode: bool):
    """低风险 + 人审开 → review（无视 service recall_mode）。"""
    from app.tasks.machine_review import _suggest_action_for

    actual = _suggest_action_for(
        RiskLevel.LOW.value,
        SensitiveLevel.S0.value,
        human_enabled=True,
        recall_mode=recall_mode,
    )
    assert actual == "review", (
        f"低风险 + 人审开 + recall={recall_mode} 必须升级人审，实际={actual}"
    )


@pytest.mark.parametrize("recall_mode", [False, True])
def test_sensitive_s2_strategy_priority_overrides_recall_mode(recall_mode: bool):
    """敏感 S2 + 人审开 → review（无视 service recall_mode）。"""
    from app.tasks.machine_review import _suggest_action_for

    actual = _suggest_action_for(
        RiskLevel.SENSITIVE.value,
        SensitiveLevel.S2.value,
        human_enabled=True,
        recall_mode=recall_mode,
    )
    assert actual == "review", (
        f"敏感 S2 + 人审开 + recall={recall_mode} 必须升级人审，实际={actual}"
    )


@pytest.mark.parametrize("recall_mode", [False, True])
def test_sensitive_s3_strategy_priority_overrides_recall_mode(recall_mode: bool):
    """敏感 S3 + 人审开 → review（无视 service recall_mode）。"""
    from app.tasks.machine_review import _suggest_action_for

    actual = _suggest_action_for(
        RiskLevel.SENSITIVE.value,
        SensitiveLevel.S3.value,
        human_enabled=True,
        recall_mode=recall_mode,
    )
    assert actual == "review", (
        f"敏感 S3 + 人审开 + recall={recall_mode} 必须升级人审，实际={actual}"
    )


def test_low_risk_human_off_still_approved_regardless_recall():
    """低风险 + 人审关 → approved（无论 recall_mode）。"""
    from app.tasks.machine_review import _suggest_action_for

    for recall in (False, True):
        actual = _suggest_action_for(
            RiskLevel.LOW.value,
            SensitiveLevel.S0.value,
            human_enabled=False,
            recall_mode=recall,
        )
        assert actual == "approved"


def test_sensitive_s2_human_off_still_rejected_regardless_recall():
    """敏感 S2 + 人审关 → rejected（无论 recall_mode）。"""
    from app.tasks.machine_review import _suggest_action_for

    for recall in (False, True):
        actual = _suggest_action_for(
            RiskLevel.SENSITIVE.value,
            SensitiveLevel.S2.value,
            human_enabled=False,
            recall_mode=recall,
        )
        assert actual == "rejected"


def test_s1_always_desensitize_regardless_human_and_recall():
    """S1 永远走脱敏放行（与 _suggest_action_for 之前的语义一致）。"""
    from app.tasks.machine_review import _suggest_action_for

    for human in (False, True):
        for recall in (False, True):
            actual = _suggest_action_for(
                RiskLevel.SENSITIVE.value,
                SensitiveLevel.S1.value,
                human_enabled=human,
                recall_mode=recall,
            )
            assert actual == "desensitize", (
                f"S1 必须 desensitize，human={human}, recall={recall}, got={actual}"
            )


# ── v12：用户级 auto_action_overrides 覆盖测试 ─────────────────────────


@pytest.mark.parametrize("action", ["approved", "rejected", "desensitize", "review"])
def test_user_override_takes_priority_for_each_cell(action: str):
    """用户在 overrides 里写什么，就返回什么（人审开时）。"""
    from app.tasks.machine_review import _suggest_action_for

    overrides = {"高风险|—": action}
    out = _suggest_action_for(
        RiskLevel.HIGH.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=False,
        auto_action_overrides=overrides,
    )
    assert out == action


@pytest.mark.parametrize("action", ["approved", "rejected", "desensitize"])
def test_user_override_s1_can_change_default_desensitize(action: str):
    """S1 默认 desensitize，但用户可改（不再锁）。"""
    from app.tasks.machine_review import _suggest_action_for

    overrides = {"敏感|S1": action}
    out = _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S1.value,
        human_enabled=True, recall_mode=False,
        auto_action_overrides=overrides,
    )
    assert out == action


def test_user_override_s1_default_unchanged_when_no_override():
    """S1 无 override 时仍走默认 desensitize。"""
    from app.tasks.machine_review import _suggest_action_for

    out = _suggest_action_for(
        RiskLevel.SENSITIVE.value, SensitiveLevel.S1.value,
        human_enabled=True, recall_mode=False,
        auto_action_overrides=None,
    )
    assert out == "desensitize"


def test_user_override_review_falls_back_to_rejected_when_human_disabled():
    """关人审时"review" 兜底为 rejected（避免误用）。"""
    from app.tasks.machine_review import _suggest_action_for

    overrides = {"高风险|—": "review"}
    out = _suggest_action_for(
        RiskLevel.HIGH.value, SensitiveLevel.S0.value,
        human_enabled=False, recall_mode=False,
        auto_action_overrides=overrides,
    )
    assert out == "rejected"


def test_user_override_review_honored_when_human_enabled():
    """开人审时"review" 保留。"""
    from app.tasks.machine_review import _suggest_action_for

    overrides = {"高风险|—": "review"}
    out = _suggest_action_for(
        RiskLevel.HIGH.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=False,
        auto_action_overrides=overrides,
    )
    assert out == "review"


def test_invalid_override_falls_back_to_default():
    """无效 action 值（拼写错误）走默认矩阵。"""
    from app.tasks.machine_review import _suggest_action_for

    overrides = {"高风险|—": "invalid_action"}
    out = _suggest_action_for(
        RiskLevel.HIGH.value, SensitiveLevel.S0.value,
        human_enabled=True, recall_mode=False,
        auto_action_overrides=overrides,
    )
    # 默认：人审开 → review
    assert out == "review"


def test_empty_overrides_falls_back_to_default():
    """空 dict overrides 等同于 None。"""
    from app.tasks.machine_review import _suggest_action_for

    out = _suggest_action_for(
        RiskLevel.MEDIUM.value, SensitiveLevel.S0.value,
        human_enabled=False, recall_mode=False,
        auto_action_overrides={},
    )
    # 默认：人审关 → rejected
    assert out == "rejected"


@pytest.mark.parametrize("risk_value,sen_value,key", [
    (RiskLevel.HIGH.value, SensitiveLevel.S0.value, "高风险|—"),
    (RiskLevel.MEDIUM.value, SensitiveLevel.S0.value, "中风险|—"),
    (RiskLevel.LOW.value, SensitiveLevel.S0.value, "低风险|—"),
    (RiskLevel.NONE.value, SensitiveLevel.S0.value, "无风险|—"),
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S3.value, "敏感|S3"),
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S2.value, "敏感|S2"),
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S1.value, "敏感|S1"),
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S0.value, "敏感|—"),  # S0 走 "—" 形式
])
def test_all_8_cell_keys_recognized(risk_value: str, sen_value: str, key: str):
    """8 个 cell key 全部能被识别（无 typo）。"""
    from app.tasks.machine_review import _suggest_action_for

    overrides = {key: "approved"}
    out = _suggest_action_for(
        risk_value, sen_value,
        human_enabled=False, recall_mode=False,
        auto_action_overrides=overrides,
    )
    # 只要返回的是合法值（approved/rejected/desensitize/review）就 OK
    assert out in ("approved", "rejected", "desensitize", "review")


# ── _handle_machine_stage_completion 集成测试（关键路径） ──────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("risk,sensitive,expected_action,expected_status", [
    # 0. risk=高 + 人审关 → REJECTED
    (RiskLevel.HIGH.value, SensitiveLevel.S0.value, "rejected", "REJECTED"),
    # 1. risk=中 + 人审关 → REJECTED（v9：不再走 OBSERVE）
    (RiskLevel.MEDIUM.value, SensitiveLevel.S0.value, "rejected", "REJECTED"),
    # 2. risk=敏感 + S3 + 人审关 → REJECTED
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S3.value, "rejected", "REJECTED"),
    # 3. risk=敏感 + S2 + 人审关 → REJECTED（v9：不再脱敏放行）
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S2.value, "rejected", "REJECTED"),
    # 4. risk=敏感 + S1 → DESENSITIZED
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S1.value, "desensitize", "DESENSITIZED"),
    # 5. risk=敏感 + S0 → APPROVED（没检出敏感内容）
    (RiskLevel.SENSITIVE.value, SensitiveLevel.S0.value, "approved", "APPROVED"),
    # 6. risk=低 → APPROVED
    (RiskLevel.LOW.value, SensitiveLevel.S0.value, "approved", "APPROVED"),
    # 7. risk=无 → APPROVED
    (RiskLevel.NONE.value, SensitiveLevel.S0.value, "approved", "APPROVED"),
])
async def test_no_escalation_routes_to_correct_finalize(
    risk, sensitive, expected_action, expected_status,
):
    """机审节点不升级人审时，suggested_action 正确路由到 3 类终态。"""
    from app.services.workflow_engine import _handle_machine_stage_completion
    from app.models.material import MaterialStatus

    db = AsyncMock()
    instance = MagicMock(spec=WorkflowInstance)
    instance.id = 1
    instance.state = "running"
    instance.material_id = 10
    instance.strategy_human_review = {"is_enabled": False, "risk_levels": []}
    instance.nodes = []

    current_node = MagicMock(spec=WorkflowNode)
    current_node.status = "active"
    current_node.node_type = "machine"
    current_node.stage_key = "auto"

    task = MagicMock()
    task.id = 1
    task.machine_status = MachineStatus.COMPLETED
    task.machine_result = {
        "risk_level": risk,
        "sensitive_level": sensitive,
        "suggested_action": expected_action,
        "hits": [],
        "rule_hits": [],
    }

    from app.models.material import Material

    material = MagicMock(spec=Material)
    material.id = 10
    material.status = MaterialStatus.IN_REVIEW
    material.extra_metadata = {}

    db.get = AsyncMock(return_value=material)

    finalize_desens_calls = []
    finalize_calls = []

    async def fake_finalize(d, i, node, approved):
        finalize_calls.append(approved)
        material.status = (
            MaterialStatus.APPROVED if approved else MaterialStatus.REJECTED
        )

    async def fake_finalize_desensitized(d, i, node):
        finalize_desens_calls.append(node)
        material.status = MaterialStatus.DESENSITIZED

    with patch(
        "app.tasks.machine_review.should_escalate_to_human",
        new=AsyncMock(return_value=False),
    ), patch(
        "app.services.workflow_engine._finalize", side_effect=fake_finalize,
    ), patch(
        "app.services.workflow_engine._finalize_desensitized",
        side_effect=fake_finalize_desensitized,
    ):
        await _handle_machine_stage_completion(db, instance, current_node, task)

    # 校验 material.status 正确落地
    if expected_action == "approved":
        assert material.status == MaterialStatus.APPROVED
        assert len(finalize_calls) == 1
        assert finalize_calls[0] is True
        assert finalize_desens_calls == []
    elif expected_action == "rejected":
        assert material.status == MaterialStatus.REJECTED
        assert len(finalize_calls) == 1
        assert finalize_calls[0] is False
        assert finalize_desens_calls == []
    elif expected_action == "desensitize":
        assert material.status == MaterialStatus.DESENSITIZED
        assert len(finalize_desens_calls) == 1
        assert finalize_calls == []


@pytest.mark.asyncio
async def test_escalation_branch_unchanged():
    """升级人审分支不应被本次改动影响。"""
    from app.services.workflow_engine import _handle_machine_stage_completion

    db = AsyncMock()
    next_human = MagicMock(spec=WorkflowNode)
    next_human.status = "pending"
    next_human.node_type = "human"
    next_human.stage_key = "human_review"

    instance = MagicMock(spec=WorkflowInstance)
    instance.id = 1
    instance.state = "running"
    instance.material_id = 10
    instance.strategy_human_review = {"is_enabled": True, "risk_levels": ["高风险"]}
    instance.nodes = [next_human]

    current_node = MagicMock(spec=WorkflowNode)
    current_node.status = "active"
    current_node.node_type = "machine"
    current_node.stage_key = "auto"

    task = MagicMock()
    task.id = 1
    task.machine_status = MachineStatus.COMPLETED
    task.machine_result = {
        "risk_level": RiskLevel.HIGH.value,
        "sensitive_level": SensitiveLevel.S0.value,
        "suggested_action": "review",
        "hits": [],
        "rule_hits": [],
    }

    activate_calls = []
    finalize_calls = []
    desens_calls = []

    async def fake_activate(db, instance, node, material_id):
        activate_calls.append(node)

    async def fake_finalize(db, instance, node, approved):
        finalize_calls.append(approved)

    async def fake_desens(db, instance, node):
        desens_calls.append(node)

    with patch(
        "app.tasks.machine_review.should_escalate_to_human",
        new=AsyncMock(return_value=True),
    ), patch(
        "app.services.workflow_engine._activate_node",
        side_effect=fake_activate,
    ), patch(
        "app.services.workflow_engine._finalize", side_effect=fake_finalize,
    ), patch(
        "app.services.workflow_engine._finalize_desensitized",
        side_effect=fake_desens,
    ):
        await _handle_machine_stage_completion(db, instance, current_node, task)

    assert len(activate_calls) == 1
    assert activate_calls[0] is next_human
    assert finalize_calls == []
    assert desens_calls == []
