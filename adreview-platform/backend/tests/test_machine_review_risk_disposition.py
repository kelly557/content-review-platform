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
    """与 _suggest_action_for v9 实现严格对齐的期望值。"""
    if risk in (RiskLevel.HIGH.value, RiskLevel.MEDIUM.value):
        return "review" if human else "rejected"
    if risk == RiskLevel.SENSITIVE.value:
        if sensitive in (SensitiveLevel.S3.value, SensitiveLevel.S2.value):
            return "review" if (human and recall) else "rejected"
        if sensitive == SensitiveLevel.S1.value:
            return "desensitize"
        return "approved"  # S0
    if risk == RiskLevel.LOW.value:
        return "review" if (human and recall) else "approved"
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
