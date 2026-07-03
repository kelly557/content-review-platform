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
from app.models.workflow import WorkflowInstance, WorkflowNode

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
    definition = instance.template.definition if hasattr(instance, "template") else {}
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

    num_hits = random.randint(0, 3)
    hits = []
    for _ in range(num_hits):
        chosen = random.choice(mock_labels)
        hits.append({
            "service_code": service_code,
            "service_name": f"Mock 检测服务 ({service_code})",
            "label": chosen["label"],
            "label_cn": chosen["label_cn"],
            "score": round(random.uniform(0.6, 0.99), 2),
            "quote": f"模拟命中片段 #{random.randint(1, 100)}",
            "bbox": None,
            "page": None,
            "timestamp_ms": None,
        })

    return hits


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
    """Simulate network delay for mock service."""
    import asyncio
    await asyncio.sleep(random.uniform(0.5, 2.0))


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