"""Machine review task: async execution of AI detection services."""
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
from app.models.workflow import WorkflowInstance, WorkflowNode, WorkflowTemplate

log = get_logger(__name__)


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

        risk_level = aggregate_risk_level(hits)

        rule_hits = _generate_mock_rule_hits(hits)

        task.machine_result = {
            "risk_level": risk_level,
            "hits": hits,
            "rule_hits": rule_hits,
            "summary": f"检测到 {len(hits)} 条命中，风险等级：{risk_level}",
        }
        task.machine_status = MachineStatus.COMPLETED
        task.machine_completed_at = datetime.now(timezone.utc)
        await db.commit()

        log.info(f"Machine review completed for task {task_id}, risk_level={risk_level}")

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
    """Mock detection service that returns random hits."""
    await _simulate_network_delay()

    mock_labels = [
        {"label": "medical_ad_violation", "label_cn": "医疗广告违规", "risk": "高风险"},
        {"label": "financial_risk_warning", "label_cn": "金融风险提示", "risk": "中风险"},
        {"label": "sensitive_content", "label_cn": "敏感内容", "risk": "低风险"},
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

    return hits


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
    """Aggregate risk level from hits."""
    if not hits:
        return "无风险"

    risk_scores = {"高风险": 3, "中风险": 2, "低风险": 1, "无风险": 0}
    max_score = 0
    for hit in hits:
        label_cn = hit.get("label_cn", "")
        if "医疗" in label_cn or "政治" in label_cn:
            max_score = max(max_score, 3)
        elif "金融" in label_cn:
            max_score = max(max_score, 2)
        elif "敏感" in label_cn:
            max_score = max(max_score, 1)

    for level, score in risk_scores.items():
        if score == max_score:
            return level
    return "无风险"


def _generate_mock_rule_hits(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Generate mock rule hits based on detection hits."""
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
            })
    return rule_hits


async def _simulate_network_delay() -> None:
    """Simulate short network delay for the mock service."""
    import asyncio
    await asyncio.sleep(random.uniform(0.1, 0.4))


async def should_escalate_to_human(
    db: AsyncSession,
    task: ReviewTask,
    force_human_rules: List[str] | None = None,
) -> bool:
    """Determine if machine review result should escalate to human review."""
    if not task.machine_result:
        return False

    risk_level = task.machine_result.get("risk_level", "无风险")
    hits = task.machine_result.get("hits", [])

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