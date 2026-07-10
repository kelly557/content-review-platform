"""Seed analytics demo data for the 数据分析 page.

Generates 30 days of material + review_task data so the trend / anomaly /
quality tabs have something to visualize. Safe to re-run: previously
generated ``__ANALYTICS_DEMO__`` rows are removed first.

Strategy
--------
* Materials are spread over the last ``--days`` days (default 30) with
  more recent days getting more volume (typical for live systems).
* Each material has a single version and a single review task.
* Decisions are randomized with a per-day baseline reject rate that
  fluctuates between 8%-22% and includes a couple of deliberate spikes
  to exercise the anomaly detector.
* A small fraction (3-5%) of tasks have a machine-vs-human disagreement
  (misjudge / miss) so the quality tab has something to show.
* ``--limit`` caps total rows (for fast iteration).
* ``--reset`` purges *all* ``__ANALYTICS_DEMO__`` rows before regenerating.

Usage::

    cd backend && source .venv/bin/activate
    PYTHONPATH=. python3 scripts/seed_analytics_demo.py            # 30d, ~3000 rows
    PYTHONPATH=. python3 scripts/seed_analytics_demo.py --days 14
    PYTHONPATH=. python3 scripts/seed_analytics_demo.py --reset
"""
from __future__ import annotations

import argparse
import asyncio
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base  # noqa: F401 — triggers model registration
from app.db.session import SessionLocal, engine
from app.models.material import Material, MaterialStatus, MaterialType, MaterialVersion
from app.models.review import (
    MachineStatus,
    ReviewAssignment,
    ReviewAssignmentTag,
    ReviewDecision,
    ReviewTask,
    ReviewType,
)
from app.models.user import User
from app.models.workflow import WorkflowInstance, WorkflowTemplate

DEMO_PREFIX = "__ANALYTICS_DEMO__"
REJECT_REASONS = [
    "[广告法] 极限用语",
    "[标签违规] 命中禁止标签",
    "[隐私] 联系方式外泄",
    "[医疗] 医疗宣称未授权",
    "[金融] 投资承诺违规",
    "[未成年人] 不当场景",
]
REJECT_TAG_CODES = [
    ("tag_ads_absolute", "绝对化用语"),
    ("tag_privacy_leak", "隐私泄露"),
    ("tag_medical_claim", "医疗宣称"),
    ("tag_finance_promise", "金融承诺"),
    ("tag_minor_image", "未成年人形象"),
]


def _baseline_reject_rate(day_idx: int, total_days: int) -> float:
    """Per-day reject rate. Adds 2 deliberate spikes for the anomaly demo."""
    base = 0.12 + 0.04 * math.sin(day_idx / 3.0)  # smooth wave
    # Inject two spikes: one at the midpoint, one near the end
    if day_idx == total_days // 2:
        base += 0.18
    if day_idx == total_days - 2:
        base += 0.12
    return max(0.04, min(0.45, base))


def _volume(day_idx: int, total_days: int) -> int:
    """Per-day submit volume: ramps up over time."""
    return int(60 + 30 * (day_idx / max(1, total_days)) + random.randint(0, 30))


async def _get_submitter(db: AsyncSession) -> User:
    res = await db.execute(
        select(User).where(User.email == "submitter@adreview.example.com")
    )
    user = res.scalar_one_or_none()
    if not user:
        raise SystemExit(
            "submitter user missing — run `python3 scripts/seed.py` first."
        )
    return user


async def _get_reviewer(db: AsyncSession) -> User:
    res = await db.execute(
        select(User).where(User.email == "reviewer@adreview.example.com")
    )
    return res.scalar_one()


async def _get_mlr(db: AsyncSession) -> User:
    res = await db.execute(
        select(User).where(User.email == "mlr@adreview.example.com")
    )
    return res.scalar_one()


async def _purge(db: AsyncSession) -> int:
    """Delete any previously seeded demo rows (cascade via ORM)."""
    from app.models.review import ReviewAssignment, ReviewAssignmentTag, ReviewTask
    from app.models.workflow import WorkflowInstance

    mats = (
        await db.execute(
            select(Material).where(Material.title.like(f"{DEMO_PREFIX}%"))
        )
    ).scalars().all()
    count = 0
    for m in mats:
        # Clear the self-FK to allow version deletion
        m.current_version_id = None
        await db.flush()
        # Cascade by hand to avoid ORM-issued UPDATE-MVs
        versions = (
            await db.execute(
                select(MaterialVersion).where(MaterialVersion.material_id == m.id)
            )
        ).scalars().all()
        for v in versions:
            tasks = (
                await db.execute(
                    select(ReviewTask).where(ReviewTask.material_id == m.id)
                )
            ).scalars().all()
            for t in tasks:
                assigns = (
                    await db.execute(
                        select(ReviewAssignment).where(
                            ReviewAssignment.task_id == t.id
                        )
                    )
                ).scalars().all()
                for a in assigns:
                    await db.execute(
                        ReviewAssignmentTag.__table__.delete().where(
                            ReviewAssignmentTag.assignment_id == a.id
                        )
                    )
                    await db.delete(a)
                await db.delete(t)
        for v in versions:
            await db.delete(v)
        wis = (
            await db.execute(
                select(WorkflowInstance).where(WorkflowInstance.material_id == m.id)
            )
        ).scalars().all()
        for wi in wis:
            await db.delete(wi)
        await db.delete(m)
        count += 1
    await db.flush()
    return count


async def _ensure_template(db: AsyncSession) -> WorkflowTemplate:
    res = await db.execute(
        select(WorkflowTemplate).where(WorkflowTemplate.code == "simple")
    )
    tpl = res.scalar_one_or_none()
    if not tpl:
        tpl = WorkflowTemplate(
            code="simple",
            name="两级审核 (demo)",
            definition={"stages": []},
        )
        db.add(tpl)
        await db.flush()
    return tpl


async def _generate(
    db: AsyncSession,
    *,
    days: int,
    limit: int,
    submitter: User,
    reviewer: User,
    mlr: User,
    template: WorkflowTemplate,
) -> int:
    """Generate demo materials and review tasks."""
    now = datetime.now(timezone.utc)
    rng = random.Random(20240601)
    generated = 0
    for day_idx in range(days):
        if generated >= limit:
            break
        # day_start = midnight UTC of (today - (days-1) + day_idx)
        day_start = (now - timedelta(days=days - 1 - day_idx)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        n_today = _volume(day_idx, days)
        reject_rate = _baseline_reject_rate(day_idx, days)
        for i in range(n_today):
            if generated >= limit:
                break
            # Spread within the day
            hour = int(rng.uniform(0, 23))
            minute = int(rng.uniform(0, 59))
            submitted_at = day_start + timedelta(hours=hour, minutes=minute)
            if submitted_at > now:
                # Skip rows that would land in the future.
                continue

            roll = rng.random()
            if roll < reject_rate:
                final_status = MaterialStatus.REJECTED
            elif roll < reject_rate + 0.04:
                final_status = MaterialStatus.WITHDRAWN  # counts as reject for trends
            else:
                final_status = MaterialStatus.APPROVED

            material = Material(
                title=f"{DEMO_PREFIX} {submitted_at:%Y-%m-%d %H:%M} {i}",
                material_type=MaterialType.TEXT,
                status=final_status,
                submitter_id=submitter.id,
                created_at=submitted_at,
                updated_at=submitted_at + timedelta(minutes=rng.randint(5, 60)),
            )
            db.add(material)
            await db.flush()
            version = MaterialVersion(
                material_id=material.id,
                version_no=1,
                storage_key=f"qa/{material.id}/v1.txt",
                original_filename="demo.txt",
                mime_type="text/plain",
                file_size=rng.randint(100, 5000),
                text_body="demo analytics material",
                created_by_id=submitter.id,
                created_at=submitted_at,
            )
            db.add(version)
            await db.flush()
            material.current_version_id = version.id

            wi = WorkflowInstance(
                template_id=template.id,
                material_id=material.id,
                material_version_id=version.id,
                state=("approved" if final_status == MaterialStatus.APPROVED else "rejected"),
                created_at=submitted_at,
                completed_at=submitted_at + timedelta(minutes=rng.randint(10, 90)),
            )
            db.add(wi)
            await db.flush()

            # Decide machine result. 6% misjudge (machine=approved, human=rejected),
            # 4% miss (machine=rejected, human=approved).
            machine_label = "pass" if rng.random() < 0.7 else "block"
            # Map labels
            if machine_label == "pass":
                machine_dec = "approved"
                risk = rng.choice(["低风险", "无风险"])
            else:
                machine_dec = "rejected"
                risk = rng.choice(["高风险", "中风险"])
            final_human = (
                MaterialStatus.REJECTED
                if final_status in (MaterialStatus.REJECTED, MaterialStatus.WITHDRAWN)
                else MaterialStatus.APPROVED
            )
            # Inject misjudge/miss: 6% misjudge (machine=approved but human=reject),
            # 4% miss (machine=rejected but human=approved).
            if rng.random() < 0.06:
                machine_dec = "approved"
                risk = rng.choice(["低风险", "无风险"])
                final_human = MaterialStatus.REJECTED
            elif rng.random() < 0.04:
                machine_dec = "rejected"
                risk = rng.choice(["高风险", "中风险"])
                final_human = MaterialStatus.APPROVED

            final_dec = (
                ReviewDecision.REJECTED
                if final_human in (MaterialStatus.REJECTED, MaterialStatus.WITHDRAWN)
                else ReviewDecision.APPROVED
            )

            machine_completed_at = submitted_at + timedelta(seconds=rng.randint(5, 90))
            human_decided_at = submitted_at + timedelta(minutes=rng.randint(5, 30))
            task = ReviewTask(
                material_id=material.id,
                material_version_id=version.id,
                workflow_instance_id=wi.id,
                stage_key="initial",
                title=f"{DEMO_PREFIX} task #{material.id}",
                review_type=ReviewType.HUMAN,
                final_decision=final_dec,
                machine_status=MachineStatus.COMPLETED,
                machine_result={
                    "risk_level": risk,
                    "strategy": {"code": "demo_strategy", "name": "Demo"},
                    "summary": "seeded by seed_analytics_demo.py",
                },
                machine_started_at=submitted_at,
                machine_completed_at=machine_completed_at,
                created_at=submitted_at,
                completed_at=human_decided_at,
            )
            db.add(task)
            await db.flush()

            # Reviewer note is set AFTER the misjudge/miss injection so it
            # always matches the final human decision.
            reviewer_note = (
                rng.choice(REJECT_REASONS)
                if final_dec == ReviewDecision.REJECTED
                else "无问题"
            )
            # Always one reviewer assignment; sometimes also an MLR one.
            reviewer_assign = ReviewAssignment(
                task_id=task.id,
                assignee_id=reviewer.id,
                decision=final_dec,
                note=reviewer_note,
                decided_at=human_decided_at,
            )
            db.add(reviewer_assign)
            await db.flush()

            if final_dec == ReviewDecision.REJECTED and rng.random() < 0.5:
                tag_code, tag_name = rng.choice(REJECT_TAG_CODES)
                tag_link = ReviewAssignmentTag(
                    assignment_id=reviewer_assign.id,
                    tag_id=tag_code,
                    tag_snapshot={
                        "code": tag_code,
                        "name": tag_name,
                        "domain": "ads",
                        "category": "claim",
                        "status": "active",
                    },
                )
                db.add(tag_link)

            if rng.random() < 0.3:
                mlr_assign = ReviewAssignment(
                    task_id=task.id,
                    assignee_id=mlr.id,
                    decision=final_dec,
                    note="MLR 复核" if final_dec == ReviewDecision.APPROVED else "MLR 二次复核",
                    decided_at=human_decided_at + timedelta(minutes=5),
                )
                db.add(mlr_assign)

            generated += 1
        # commit per-day to keep memory bounded
        await db.commit()
    return generated


async def main(days: int, limit: int, reset: bool) -> None:
    print(f"seed_analytics_demo: days={days}, limit={limit}, reset={reset}")
    async with SessionLocal() as db:
        if reset:
            purged = await _purge(db)
            # Also clear any demo alerts
            from sqlalchemy import delete
            from app.models.alert_event import AlertEvent
            await db.execute(delete(AlertEvent))
            await db.commit()
            if purged:
                print(f"purged {purged} existing demo materials")
        submitter = await _get_submitter(db)
        reviewer = await _get_reviewer(db)
        mlr = await _get_mlr(db)
        template = await _ensure_template(db)
        await db.commit()
        generated = await _generate(
            db,
            days=days,
            limit=limit,
            submitter=submitter,
            reviewer=reviewer,
            mlr=mlr,
            template=template,
        )
        # Seed a few demo alerts so the 异常分析 tab has something to show.
        from app.models.alert_event import AlertEvent
        from datetime import timezone
        now = datetime.now(timezone.utc)
        demo_alerts = [
            AlertEvent(
                rule_code="reject_rate_spike",
                severity="warn",
                metric="reject_rate",
                window_start=now - timedelta(minutes=30),
                window_end=now,
                observed_value=8.4,
                threshold=3.0,
                detail={
                    "source": "seed_analytics_demo",
                    "current_reject_rate": 22.5,
                    "previous_reject_rate": 14.1,
                    "current_submitted": 89,
                    "previous_submitted": 78,
                    "note": "近 30 分钟拒绝率较上一 30 分钟上升 8.4pp, 集中在 '极限用语' 类素材",
                },
            ),
            AlertEvent(
                rule_code="high_risk_concentration",
                severity="warn",
                metric="distinct_rejected_submitters",
                window_start=now - timedelta(hours=1),
                window_end=now,
                observed_value=7.0,
                threshold=5.0,
                detail={
                    "source": "seed_analytics_demo",
                    "current_submitted": 142,
                    "current_rejected": 31,
                    "note": "过去 1 小时有 7 个不同提交者产生拒绝, 超过阈值",
                },
            ),
            AlertEvent(
                rule_code="submit_drop",
                severity="info",
                metric="submitted",
                window_start=now - timedelta(hours=1),
                window_end=now,
                observed_value=42.0,
                threshold=110.0,
                detail={
                    "source": "seed_analytics_demo",
                    "previous_submitted": 110,
                    "current_submitted": 42,
                    "drop_pct": 61.82,
                    "note": "提交量较上一小时下降 61.8%, 建议检查上游入口",
                },
                status="acknowledged",
            ),
        ]
        for a in demo_alerts:
            db.add(a)
        await db.commit()
    print(f"generated {generated} demo materials+review_tasks; 3 demo alerts")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Seed analytics demo data")
    p.add_argument("--days", type=int, default=30, help="Number of days of history")
    p.add_argument("--limit", type=int, default=3000, help="Max total materials")
    p.add_argument(
        "--reset",
        action="store_true",
        help="Delete any existing __ANALYTICS_DEMO__ rows before generating",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()

    async def _run() -> None:
        try:
            await main(days=args.days, limit=args.limit, reset=args.reset)
        finally:
            await engine.dispose()

    asyncio.run(_run())
