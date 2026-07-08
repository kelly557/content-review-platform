"""Machine review task: async execution of AI detection services.

v6 refactor:
- 引入 RiskLevel.SENSITIVE = "敏感" 桶，承载 PII-only 命中
- 引入 SensitiveLevel（S0/S1/S2/S3）作为 hit 级细粒度严重度
- aggregate_risk_level 扩展识别敏感/医疗/政治/金融
- aggregate_sensitive_level 按 max 汇总素材级 S 等级
- _suggest_action_for 决策矩阵 5×4×2×2 = 80 组合
- run_machine_review 末尾把 suggested_action + desensitize_plan 写入 machine_result
"""
from __future__ import annotations

import random
from datetime import datetime, timezone
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.human_review_config import HumanReviewConfig, RiskLevel
from app.models.review import MachineStatus, ReviewTask, ReviewType
from app.models.sensitive_level import (
    SENSITIVE_LEVEL_RANK,
    SensitiveLevel,
    sensitive_level_rank,
)
from app.models.workflow import WorkflowInstance, WorkflowNode, WorkflowTemplate

log = get_logger(__name__)


# ─── 后端单一来源：素材级动作清单（与前端 HumanReviewSettings 预览表保持一致）───
RISK_LEVELS_AUTO_REJECT = (RiskLevel.HIGH.value, RiskLevel.MEDIUM.value)
RISK_LEVELS_AUTO_DESENSITIZE = (RiskLevel.SENSITIVE.value,)
RISK_LEVELS_AUTO_APPROVE = (RiskLevel.LOW.value, RiskLevel.NONE.value)

# ─── suggested_action 字符串集合（与 workflow_engine 解析保持一致）─────────────
SUGGESTED_ACTION_APPROVED = "approved"
SUGGESTED_ACTION_REJECTED = "rejected"
SUGGESTED_ACTION_DESENSITIZE = "desensitize"
SUGGESTED_ACTION_REVIEW = "review"


async def run_machine_review(task_id: int, db: AsyncSession) -> None:
    """Execute machine review for a given task."""
    result = await db.execute(
        select(ReviewTask)
        .where(ReviewTask.id == task_id)
        .options(
            selectinload(ReviewTask.assignments),
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        log.warning(f"Task {task_id} not found")
        return

    if task.review_type != ReviewType.MACHINE:
        log.warning(f"Task {task_id} is not a machine review task")
        return

    task.machine_status = MachineStatus.RUNNING
    task.machine_started_at = datetime.now(timezone.utc)
    await db.commit()

    try:
        instance_result = await db.execute(
            select(WorkflowInstance)
            .where(WorkflowInstance.id == task.workflow_instance_id)
            .options(selectinload(WorkflowInstance.nodes))
        )
        instance = instance_result.scalar_one()

        # Avoid lazy-loading `instance.template` in the async context
        # (triggers greenlet_spawn errors). Load the template explicitly.
        template_result = await db.execute(
            select(WorkflowTemplate).where(WorkflowTemplate.id == instance.template_id)
        )
        template = template_result.scalar_one()
        instance._template_cache = template

        stage_config = _get_stage_config(instance, task.stage_key)
        services = stage_config.get("services", ["text_detection_pro"])

        hits = []
        for svc_code in services:
            svc_hits = await call_mock_detection(svc_code, task.material_version_id)
            hits.extend(svc_hits)

        # 1. 素材级 risk_level（5 档：高/中/低/敏感/无）
        risk_level = aggregate_risk_level(hits)

        # 2. 素材级 sensitive_level（S0/S1/S2/S3，按 max 汇总）
        sensitive_level = aggregate_sensitive_level(hits)

        # 3. 规则命中（含每个 hit 的 sensitive_grade）
        rule_hits = _generate_mock_rule_hits(hits)

        # 4. 决策矩阵：4 个上下文变量 → suggested_action
        hr_cfg = getattr(instance, "strategy_human_review", None) or {}
        human_enabled = bool(hr_cfg.get("is_enabled", False))
        recall_mode = await _get_recall_mode_for_services(db, services)
        suggested_action = _suggest_action_for(
            risk_level, sensitive_level, human_enabled, recall_mode
        )

        # 5. 写 machine_result
        machine_result: Dict[str, Any] = {
            "risk_level": risk_level,
            "sensitive_level": sensitive_level,
            "hits": hits,
            "rule_hits": rule_hits,
            "suggested_action": suggested_action,
            "summary": (
                f"检测到 {len(hits)} 条命中，"
                f"风险等级：{risk_level}，敏感等级：{sensitive_level}"
            ),
        }

        # 6. 敏感档（risk=敏感 且 sensitive ≥ S1）→ 生成 desensitize_plan
        if risk_level == RiskLevel.SENSITIVE.value and sensitive_level != SensitiveLevel.S0.value:
            machine_result["desensitize_plan"] = _build_desensitize_plan(hits)

        task.machine_result = machine_result
        task.machine_status = MachineStatus.COMPLETED
        task.machine_completed_at = datetime.now(timezone.utc)
        await db.commit()

        log.info(
            f"Machine review completed for task {task_id}, "
            f"risk_level={risk_level}, sensitive_level={sensitive_level}, "
            f"suggested_action={suggested_action}"
        )

        from app.services.workflow_engine import evaluate_stage_completion
        await evaluate_stage_completion(db, instance)

    except Exception as e:
        log.error(f"Machine review failed for task {task_id}: {e}")
        task.machine_status = MachineStatus.FAILED
        task.machine_result = {"error": str(e)}
        await db.commit()
        raise


def _get_stage_config(instance: WorkflowInstance, stage_key: str) -> Dict[str, Any]:
    """Extract config for a given stage from the workflow template definition."""
    template = getattr(instance, "_template_cache", None)
    if template is None:
        template = getattr(instance, "template", None)
    definition = template.definition if template is not None else {}
    stages = definition.get("stages", [])
    for stage in stages:
        if stage.get("key") == stage_key:
            return stage.get("config", {})
    return {}


async def call_mock_detection(service_code: str, version_id: int) -> List[Dict[str, Any]]:
    """Mock detection service that returns random hits.

    每个 hit 携带 sensitive_grade（S0~S3），mock 规则：
      - 医疗/政治 → S3
      - 金融 → S2
      - 敏感内容 → S1
      - 其他 → S0
    """
    await _simulate_network_delay()

    mock_labels = [
        {"label": "medical_ad_violation", "label_cn": "医疗广告违规", "risk": "高风险"},
        {"label": "financial_risk_warning", "label_cn": "金融风险提示", "risk": "中风险"},
        {"label": "sensitive_content", "label_cn": "敏感内容", "risk": "敏感"},
        {"label": "political_content", "label_cn": "政治敏感", "risk": "高风险"},
    ]

    num_hits = random.choice([1, 2, 3])
    hits = []
    for _ in range(num_hits):
        chosen = random.choice(mock_labels)
        hits.append({
            "service_code": service_code,
            "service_name": f"Mock 检测服务 ({service_code})",
            "label": chosen["label"],
            "label_cn": chosen["label_cn"],
            "score": round(random.uniform(0.6, 0.99), 2),
            "quote": _pick_quote_for_version(version_id),
            "bbox": None,
            "page": None,
            "timestamp_ms": None,
        })

    # 给每个 hit 打 sensitive_grade（mock 规则）
    for h in hits:
        h["sensitive_grade"] = _mock_sensitive_grade_for(h)

    return hits


def _mock_sensitive_grade_for(hit: Dict[str, Any]) -> str:
    """Mock：基于 label_cn 推断 hit 的 sensitive_grade。

    真实机审服务会直接返回 sensitive_grade；mock 用关键词兜底。
    """
    lc = hit.get("label_cn", "")
    if "医疗" in lc or "政治" in lc:
        return SensitiveLevel.S3.value
    if "金融" in lc:
        return SensitiveLevel.S2.value
    if "敏感" in lc:
        return SensitiveLevel.S1.value
    return SensitiveLevel.S0.value


def _pick_quote_for_version(version_id: int) -> str:
    """Best-effort: fetch the material version's text_body and slice a window.

    Falls back to a deterministic-looking fake quote when the version is missing
    or has no text body (e.g. video / image materials).
    """
    import asyncio

    async def _inner() -> str:
        from app.db.session import SessionLocal
        from app.models.material import MaterialVersion

        try:
            async with SessionLocal() as db:
                v = await db.get(MaterialVersion, version_id)
                body = getattr(v, "text_body", None) if v else None
                if body and len(body) >= 10:
                    snippet = body.strip().replace("\n", " ")
                    if len(snippet) <= 30:
                        return f"“{snippet}”"
                    start = random.randint(0, max(0, len(snippet) - 30))
                    return f"“{snippet[start:start + random.randint(10, 30)]}…”"
        except Exception:
            pass
        return f"“模拟命中片段 #{version_id}-{random.randint(1, 99)}”"

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return f"“模拟命中片段 #{version_id}-{random.randint(1, 99)}”"
        return loop.run_until_complete(_inner())
    except Exception:
        return f"“模拟命中片段 #{version_id}-{random.randint(1, 99)}”"


def aggregate_risk_level(hits: List[Dict[str, Any]]) -> str:
    """Aggregate material-level risk_level from hits.

    5 档桶（v6）：
      - 医疗/政治 → 高风险
      - 金融 → 中风险
      - 敏感内容 → 敏感（新增）
      - 其他命中 → 低风险
      - 无命中 → 无风险
    """
    if not hits:
        return RiskLevel.NONE.value

    # 兼容旧风险字段（hit["risk"]）和关键词兜底
    explicit_priority = {
        RiskLevel.HIGH.value: 4,
        RiskLevel.MEDIUM.value: 3,
        RiskLevel.SENSITIVE.value: 2,
        RiskLevel.LOW.value: 1,
        RiskLevel.NONE.value: 0,
    }
    max_score = 0
    for hit in hits:
        # 优先用显式 risk 字段
        risk_raw = (hit.get("risk") or "").strip()
        if risk_raw in explicit_priority:
            max_score = max(max_score, explicit_priority[risk_raw])
            continue
        # 否则按 label_cn 兜底
        label_cn = hit.get("label_cn", "")
        if "医疗" in label_cn or "政治" in label_cn:
            max_score = max(max_score, 4)
        elif "金融" in label_cn:
            max_score = max(max_score, 3)
        elif "敏感" in label_cn:
            max_score = max(max_score, 2)
        else:
            max_score = max(max_score, 1)

    if max_score >= 4:
        return RiskLevel.HIGH.value
    if max_score >= 3:
        return RiskLevel.MEDIUM.value
    if max_score >= 2:
        return RiskLevel.SENSITIVE.value
    if max_score >= 1:
        return RiskLevel.LOW.value
    return RiskLevel.NONE.value


def aggregate_sensitive_level(hits: List[Dict[str, Any]]) -> str:
    """Aggregate material-level SensitiveLevel from hit-level sensitive_grade.

    取 max（"严重度最高原则"）；全无 S 字段 → S0。
    """
    best_rank = 0
    best_level = SensitiveLevel.S0.value
    for hit in hits:
        grade = hit.get("sensitive_grade")
        rank = sensitive_level_rank(grade)
        if rank > best_rank:
            best_rank = rank
            best_level = grade if isinstance(grade, str) else (
                grade.value if hasattr(grade, "value") else SensitiveLevel.S0.value
            )
    return best_level


def _generate_mock_rule_hits(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generate mock rule hits based on detection hits.

    每个 rule_hit 透传对应 hit 的 sensitive_grade。
    """
    rule_hits = []
    seen_labels = set()
    for hit in hits:
        label = hit.get("label")
        if label and label not in seen_labels:
            seen_labels.add(label)
            rule_hits.append({
                "rule_id": random.randint(1, 100),
                "label": label,
                "label_cn": hit.get("label_cn", label),
                "threshold": 0.5,
                "matched": True,
                "sensitive_grade": hit.get("sensitive_grade", SensitiveLevel.S0.value),
            })
    return rule_hits


def _build_desensitize_plan(hits: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build desensitize plan from sensitive hits (risk=敏感 且 sensitive ≥ S1).

    每个 entry 携带 label、label_cn、original (hit.quote)、sensitive_grade。
    desensitization.apply API 会读取此 plan 并执行 mask。
    """
    entries: List[Dict[str, Any]] = []
    for hit in hits:
        grade = hit.get("sensitive_grade", SensitiveLevel.S0.value)
        if sensitive_level_rank(grade) < sensitive_level_rank(SensitiveLevel.S1):
            continue
        entries.append({
            "label": hit.get("label"),
            "label_cn": hit.get("label_cn"),
            "category": hit.get("label"),  # 粗略分类
            "original": hit.get("quote"),
            "sensitive_grade": grade,
        })
    return {
        "category": "sensitive",
        "entries": entries,
    }


async def _get_recall_mode_for_services(
    db: AsyncSession, service_codes: List[str]
) -> bool:
    """Return True if ANY of the given services has HumanReviewConfig.recall_mode=True."""
    if not service_codes:
        return False
    try:
        result = await db.execute(
            select(HumanReviewConfig).where(
                HumanReviewConfig.service_code.in_(service_codes)
            )
        )
        configs = list(result.scalars())
    except Exception:
        return False
    return any(c.recall_mode for c in configs)


def _suggest_action_for(
    risk_level: str,
    sensitive_level: str,
    human_enabled: bool,
    recall_mode: bool,
) -> str:
    """决策矩阵（5 risk × 4 sensitive × 2 human × 2 recall = 80 组合）。

    核心规则：
      - 高风险 / 中风险 → 人审开 → review；人审关 → rejected（不放行）
      - 敏感 + S3 / S2   → 人审开+召回 → review；其他 → rejected（不放行）
      - 敏感 + S1        → desensitize（脱敏放行，无视人审/召回）
      - 敏感 + S0        → approved（没检出敏感内容，放行）
      - 低风险 / 无风险  → 人审开+召回 → review；其他 → approved
    """
    if risk_level == RiskLevel.HIGH.value:
        return (
            SUGGESTED_ACTION_REVIEW
            if human_enabled
            else SUGGESTED_ACTION_REJECTED
        )

    if risk_level == RiskLevel.MEDIUM.value:
        return (
            SUGGESTED_ACTION_REVIEW
            if human_enabled
            else SUGGESTED_ACTION_REJECTED
        )

    if risk_level == RiskLevel.SENSITIVE.value:
        if sensitive_level in (SensitiveLevel.S3.value, SensitiveLevel.S2.value):
            return (
                SUGGESTED_ACTION_REVIEW
                if (human_enabled and recall_mode)
                else SUGGESTED_ACTION_REJECTED
            )
        if sensitive_level == SensitiveLevel.S1.value:
            return SUGGESTED_ACTION_DESENSITIZE
        # S0：没检出敏感内容，放行
        return SUGGESTED_ACTION_APPROVED

    if risk_level == RiskLevel.LOW.value:
        return (
            SUGGESTED_ACTION_REVIEW
            if (human_enabled and recall_mode)
            else SUGGESTED_ACTION_APPROVED
        )

    # RiskLevel.NONE
    return SUGGESTED_ACTION_APPROVED


async def _simulate_network_delay() -> None:
    """Simulate short network delay for the mock service."""
    import asyncio
    await asyncio.sleep(random.uniform(0.1, 0.4))


async def should_escalate_to_human(
    db: AsyncSession,
    task: ReviewTask,
    force_human_rules: List[str] | None = None,
    strategy_human_review: Dict[str, Any] | None = None,
) -> bool:
    """Determine if machine review result should escalate to human review.

    决策流程：
    1. 若显式传入 strategy_human_review（来自 Strategy.definition.human_review）：
       (a) is_enabled=False → 不升级人审，由 workflow_engine 按
           machine_result.suggested_action 决定 auto_approve /
           auto_reject / auto_observe / auto_desensitize
       (b) risk_level ∈ risk_levels → 升级人审，人审结果决定最终
       (c) 配置存在但未命中 → 不升级人审，走 (a)

    2. 否则（理论不可达：strategies API 总写入 definition.human_review，
       所以分支 2 在策略创建/编辑流程中实际不会被触发）
       走默认行为：高/中风险升级；force_human_rules 关键词命中升级。

    注意：auto_* 动作的拆分见 workflow_engine._handle_machine_stage_completion
    和 machine_review._suggest_action_for。
    """
    if not task.machine_result:
        return False

    risk_level = task.machine_result.get("risk_level", "无风险")
    hits = task.machine_result.get("hits", [])

    if strategy_human_review is not None:
        if not strategy_human_review.get("is_enabled", False):
            return False
        levels = strategy_human_review.get("risk_levels") or []
        if risk_level in levels:
            return True
        if force_human_rules:
            for hit in hits:
                label_cn = hit.get("label_cn", "")
                if any(rule in label_cn for rule in force_human_rules):
                    return True
        return False

    if risk_level in ["高风险", "中风险"]:
        return True

    if force_human_rules:
        for hit in hits:
            label_cn = hit.get("label_cn", "")
            for rule in force_human_rules:
                if rule in label_cn:
                    return True

    return False


async def get_human_review_config_for_service(
    db: AsyncSession, service_code: str
) -> HumanReviewConfig | None:
    """Get human review config for a service."""
    result = await db.execute(
        select(HumanReviewConfig).where(HumanReviewConfig.service_code == service_code)
    )
    return result.scalar_one_or_none()
