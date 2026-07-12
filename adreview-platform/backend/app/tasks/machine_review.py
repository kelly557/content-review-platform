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

        # 4. 决策矩阵：4 个上下文变量 + 用户自定义覆盖 → suggested_action
        hr_cfg = getattr(instance, "strategy_human_review", None) or {}
        human_enabled = bool(hr_cfg.get("is_enabled", False))
        recall_mode = await _get_recall_mode_for_services(db, services)
        # 用户覆盖嵌在 strategy_human_review dict 里
        auto_overrides = hr_cfg.get("auto_action_overrides") if isinstance(hr_cfg, dict) else None
        # 抽审比例（默认 100 = 全部升级，向后兼容）
        sample_ratio = hr_cfg.get("sample_ratio") if isinstance(hr_cfg, dict) else None
        # 用 material_id 做确定性 hash seed，保证同一素材结论稳定
        sample_seed = (
            str(getattr(task, "material_id", "") or "")
            + ":"
            + str(getattr(task, "id", "") or "")
        )
        suggested_action = _suggest_action_for(
            risk_level, sensitive_level, human_enabled, recall_mode,
            auto_action_overrides=auto_overrides,
            sample_seed=sample_seed,
            sample_ratio=sample_ratio,
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

        # v10 cancel guard: if the operator cancelled this task while we
        # were running, still persist the result (so reports remain
        # complete) but skip workflow evaluation. The instance is no
        # longer in 'running' state, so evaluate_stage_completion would
        # be a no-op anyway — but we make the intent explicit and avoid
        # any accidental stage re-activation via stale node rows.
        from app.services.workflow_engine import is_task_canceled

        if is_task_canceled(task):
            await db.commit()
            log.info(
                f"Machine review finished for task {task_id} but task was cancelled; "
                "skipping stage evaluation"
            )
            return

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
    recall_mode: bool,  # noqa: ARG001  保留签名兼容，不再参与决策
    auto_action_overrides: Dict[str, str] | None = None,
    sample_seed: str | None = None,
    sample_ratio: float | None = None,
) -> str:
    """决策矩阵（5 risk × 4 sensitive × 2 human = 40 组合）。

    策略级优先：升级人审的判定完全由策略级 risk_levels / sensitive_levels 决定
    （见 should_escalate_to_human），本函数只决定机审的 auto_* 动作，
    **不再读取 recall_mode**。``recall_mode`` 参数保留以保持调用方签名兼容。

    用户级覆盖（auto_action_overrides）：
      - key = "<risk>|<sensitive>"，sensitive = "—" 表示该 risk 无 sensitive 维度
      - value ∈ {approved, rejected, desensitize, review}
      - 用户配过的 cell 直接返回用户值（不再走默认矩阵）
      - "review" 在关人审时自动转 rejected（兜底，避免误用）

    抽审（sample_ratio）：
      - 仅在默认矩阵结论为 ``review`` 且 ``human_enabled=True`` 时生效
      - ``sample_ratio=None`` 或 ``>= 100``：全部升级（向后兼容）
      - ``sample_ratio=0``：不升级，按矩阵默认（高/中拒绝；低风险通过）
      - ``0 < sample_ratio < 100``：用 sample_seed 确定性 hash 抽样
      - 抽样 hash 使用 md5 前 8 字节（精度 0.01%），同素材同结论

    核心规则（用户未覆盖时的默认值）：
      - 高风险 / 中风险 → 人审开 → review；人审关 → rejected（不放行）
      - 敏感 + S3 / S2   → 人审开 → review；人审关 → rejected
      - 敏感 + S1        → desensitize（脱敏放行；用户可改）
      - 敏感 + S0        → approved（没检出敏感内容，放行）
      - 低风险           → 人审开 → review；人审关 → approved
      - 无风险           → approved
    """
    # 1) 用户级覆盖优先
    if auto_action_overrides:
        cell_key = (
            f"{risk_level}|{sensitive_level}"
            if sensitive_level != SensitiveLevel.S0.value
            else f"{risk_level}|—"
        )
        action = auto_action_overrides.get(cell_key)
        if action:
            # 关人审时，"review" 没有意义，降级为 rejected
            if action == SUGGESTED_ACTION_REVIEW and not human_enabled:
                return SUGGESTED_ACTION_REJECTED
            if action in (
                SUGGESTED_ACTION_APPROVED,
                SUGGESTED_ACTION_REJECTED,
                SUGGESTED_ACTION_DESENSITIZE,
                SUGGESTED_ACTION_REVIEW,
            ):
                return action
            # 无效值忽略，走默认

    # 2) 默认矩阵
    if risk_level == RiskLevel.HIGH.value:
        base_action = (
            SUGGESTED_ACTION_REVIEW
            if human_enabled
            else SUGGESTED_ACTION_REJECTED
        )
    elif risk_level == RiskLevel.MEDIUM.value:
        base_action = (
            SUGGESTED_ACTION_REVIEW
            if human_enabled
            else SUGGESTED_ACTION_REJECTED
        )
    elif risk_level == RiskLevel.SENSITIVE.value:
        if sensitive_level in (SensitiveLevel.S3.value, SensitiveLevel.S2.value):
            base_action = (
                SUGGESTED_ACTION_REVIEW
                if human_enabled
                else SUGGESTED_ACTION_REJECTED
            )
        elif sensitive_level == SensitiveLevel.S1.value:
            base_action = SUGGESTED_ACTION_DESENSITIZE
        else:
            # S0：没检出敏感内容，放行
            base_action = SUGGESTED_ACTION_APPROVED
    elif risk_level == RiskLevel.LOW.value:
        base_action = (
            SUGGESTED_ACTION_REVIEW
            if human_enabled
            else SUGGESTED_ACTION_APPROVED
        )
    else:
        # RiskLevel.NONE / 未知
        base_action = SUGGESTED_ACTION_APPROVED

    # 3) 抽样决策（仅在需要升级时介入）
    if (
        base_action == SUGGESTED_ACTION_REVIEW
        and human_enabled
        and sample_ratio is not None
        and 0 <= sample_ratio < 100
        and sample_seed
    ):
        import hashlib
        h = int(hashlib.md5(sample_seed.encode("utf-8")).hexdigest()[:8], 16)
        bucket = h % 10000  # 精度 0.01%
        if bucket >= int(sample_ratio * 100):
            # 未抽中：按矩阵降级
            # 高/中/敏感 S2/S3 → 拒绝；低风险 → 通过
            if risk_level in (
                RiskLevel.HIGH.value,
                RiskLevel.MEDIUM.value,
                RiskLevel.SENSITIVE.value,
            ):
                return SUGGESTED_ACTION_REJECTED
            return SUGGESTED_ACTION_APPROVED

    return base_action


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
       (b) risk_level ∈ risk_levels → 升级人审（与「召回模式」无关）
       (c) risk_level == "敏感" 且 sensitive_level ∈ sensitive_levels
           且 sensitive_level != "S1" → 升级人审
           （S1 永远走脱敏放行，由 _suggest_action_for 决定，不升级）
           （S2/S3 真正升级还需 service 召回模式开启，由 _suggest_action_for 决定）
       (d) force_human_rules 关键词命中 → 仍升级
       (e) 都不命中 → 不升级人审，走 (a)

    2. 否则（理论不可达：strategies API 总写入 definition.human_review，
       所以分支 2 在策略创建/编辑流程中实际不会被触发）
       走默认行为：高/中风险升级；force_human_rules 关键词命中升级。

    注意：auto_* 动作的拆分见 workflow_engine._handle_machine_stage_completion
    和 machine_review._suggest_action_for。``recall_mode`` 实际动作切换由
    _suggest_action_for 负责；本函数只负责"是否升级"的策略级判定。
    """
    if not task.machine_result:
        return False

    risk_level = task.machine_result.get("risk_level", "无风险")
    sensitive_level = task.machine_result.get("sensitive_level", "S0")
    hits = task.machine_result.get("hits", [])

    if strategy_human_review is not None:
        if not strategy_human_review.get("is_enabled", False):
            return False
        levels = strategy_human_review.get("risk_levels") or []
        sensitive_levels = strategy_human_review.get("sensitive_levels") or []

        # (b) 风险等级命中
        if risk_level in levels:
            return True

        # (c) 「敏感」档位 + 敏感等级命中（排除永远脱敏的 S1）
        if (
            risk_level == RiskLevel.SENSITIVE.value
            and sensitive_level in sensitive_levels
            and sensitive_level != SensitiveLevel.S1.value
        ):
            return True

        # (d) force_human_rules 关键词命中
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
