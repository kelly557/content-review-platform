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
import os
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


# ---------------------------------------------------------------------------
# Realistic seed corpora (12 buckets, 30+ samples) so /tasks look distinct
# in the UI and the AI reviewer's hits are grounded in real text instead of
# the legacy hardcoded "demo analytics material".
# ---------------------------------------------------------------------------

DEMO_CORPORA_HEALTHY: list[str] = [
    "本产品为普通食品，非保健品，不可替代药物治疗。",
    "新品上市，全国统一零售价 29.9 元，详见线下门店。",
    "本店开业大酬宾，全场满 100 减 20，详情咨询店员。",
    "夏日新品冰镇柠檬茶，第三杯半价，活动时间 6 月 1 日至 7 日。",
    "本服装采用新疆长绒棉，柔软透气，适合日常通勤穿着。",
    "智能扫地机器人，扫拖一体，APP 远程控制。",
    "瑜伽课程开班，每周一三五晚 7 点，会员免费。",
    "亲子游泳早教中心，提供 0-6 岁宝宝课程。",
    "全新装修两室一厅出租，押一付三，随时看房。",
    "本市公立小学招生，详见教育局公告。",
]

DEMO_CORPORA_REJECTED: list[str] = [
    "本保健品 3 天根治失眠，100% 安全无副作用，疗效第一！",
    "医疗广告：祖传秘方包治百病，一个疗程根治高血压、糖尿病。",
    "投资理财：保本保息，月收益 30%，签订回购协议。",
    "信用卡套现：5 分钟到账，最低费率，无风险无抵押。",
    "某领导人不当言论示例文本，用于测试政治违规关键词命中。",
    "【警告】含极端组织名称、爆炸物制作方法等违规内容。",
    "示例：含人身攻击、辱骂性词汇以及低俗色情暗示的混合文本。",
    "本公司为博彩平台，下注即送 188 元，首充 1000 送 500。",
    "刷单兼职：日结 200-500 元，无需押金，会打字即可。",
    "示例：某明星代言人未授权使用肖像，含明显 logo 特写。",
    "联系方式引流：加微信 abc123 领红包，仅限今日。",
    "绝对化用语：全国最低价、第一品牌、销量冠军！",
]

DEMO_CORPORA_PII: list[str] = [
    "中奖用户：张三，身份证 110101199003078531，电话 13800138000。",
    "请联系王女士（北京海淀区中关村南大街 5 号 13800138000）领取。",
    "客户档案：身份证 310115198504221217，居住地址上海市浦东新区张江路 100 号。",
    "内部通讯录：李四 138-0013-8000，邮箱 lisi@example.com。",
]

DEMO_ALL_CORPORA: list[str] = (
    DEMO_CORPORA_HEALTHY + DEMO_CORPORA_REJECTED + DEMO_CORPORA_PII
)


# Risk label → machine_result hits. Each bucket maps corpus keywords to
# structured hits the frontend's AgentReviewPanel can render, instead of
# the legacy fake "summary: seeded by ..." string.
#
# v8 fix: kept as a reference catalog only — seed_analytics_demo no longer
# invokes _detect_hits_from_text to populate ``machine_result``. Real LLM
# hits overwrite these once the operator re-triggers via the workflow UI.
DEMO_HIT_TEMPLATES: dict[str, list[dict]] = {
    "ads_absolute": [
        {"label": "ads_absolute_claim", "label_cn": "广告绝对化用语", "score": 0.93,
         "quote": "绝对化用语", "sensitive_grade": "S2"},
    ],
    "medical": [
        {"label": "medical_absolute_claim", "label_cn": "医疗绝对化宣称", "score": 0.95,
         "quote": "根治", "sensitive_grade": "S3"},
        {"label": "medical_unauthorized", "label_cn": "未经授权的医疗广告", "score": 0.88,
         "quote": "祖传秘方", "sensitive_grade": "S3"},
    ],
    "finance": [
        {"label": "finance_promise", "label_cn": "金融保本承诺", "score": 0.91,
         "quote": "保本保息", "sensitive_grade": "S3"},
        {"label": "credit_card_fraud_risk", "label_cn": "信用卡套现风险", "score": 0.86,
         "quote": "信用卡套现", "sensitive_grade": "S2"},
    ],
    "politics": [
        {"label": "political_content", "label_cn": "涉政敏感", "score": 0.97,
         "quote": "领导人", "sensitive_grade": "S3"},
    ],
    "violence": [
        {"label": "violence_extremism", "label_cn": "暴恐极端内容", "score": 0.96,
         "quote": "极端组织", "sensitive_grade": "S3"},
    ],
    "vulgar": [
        {"label": "abuse_personal_attack", "label_cn": "人身攻击", "score": 0.82,
         "quote": "辱骂", "sensitive_grade": "S1"},
        {"label": "vulgar_porn_implication", "label_cn": "低俗色情暗示", "score": 0.78,
         "quote": "色情暗示", "sensitive_grade": "S2"},
    ],
    "gambling": [
        {"label": "gambling_online", "label_cn": "网络赌博引流", "score": 0.9,
         "quote": "博彩平台", "sensitive_grade": "S3"},
    ],
    "fraud": [
        {"label": "fraud_brushing", "label_cn": "刷单诈骗", "score": 0.89,
         "quote": "刷单兼职", "sensitive_grade": "S2"},
    ],
    "ip": [
        {"label": "ip_unauthorized_use", "label_cn": "未经授权的肖像/品牌", "score": 0.85,
         "quote": "代言人", "sensitive_grade": "S1"},
    ],
    "privacy": [
        {"label": "privacy_contact_info", "label_cn": "联系方式外泄", "score": 0.87,
         "quote": "加微信", "sensitive_grade": "S2"},
    ],
    "pii": [
        {"label": "pii_id_card", "label_cn": "身份证号", "score": 0.95,
         "quote": "身份证", "sensitive_grade": "S1"},
        {"label": "pii_phone", "label_cn": "手机号", "score": 0.94,
         "quote": "13800", "sensitive_grade": "S1"},
    ],
}


def _seed_machine_summary(risk_label: str) -> str:
    """Stable, non-misleading summary for the demo seed task.

    Reads "未审核 — 请触发 /trigger-machine-review" so the UI doesn't show
    any "AI 已判定" text. The real summary is overwritten on first LLM run.
    """
    return (
        f"demo seed — 未执行 AI 审核（{risk_label}）；"
        "请触发 /trigger-machine-review 走真实链路"
    )


def _require_reseed_allowed() -> None:
    """Environmental guard: this script DELETES rows and rewrites demo data.

    Per the project policy (CLAUDE.md), the seed scripts must require an
    explicit ``RESEED_ALLOWED=YES`` env var so accidental runs against a
    populated DB are blocked. The ``--reason`` flag is enforced via argparse.
    """
    if os.environ.get("RESEED_ALLOWED") != "YES":
        sys.stderr.write(
            "[seed_analytics_demo] refusing to run: set RESEED_ALLOWED=YES to "
            "acknowledge that this script will purge existing __ANALYTICS_DEMO__ "
            "rows.\n"
        )
        sys.exit(1)


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

            # Pick a corpus that matches the final outcome so the rendered
            # hit list in /tasks is actually distinct per task. Healthy
            # texts get unique risk_label so the UI can color-chip them.
            if final_status == MaterialStatus.APPROVED:
                corpus = rng.choice(DEMO_CORPORA_HEALTHY)
                risk_label = "正常"
            elif rng.random() < 0.15:
                corpus = rng.choice(DEMO_CORPORA_PII)
                risk_label = "敏感PII"
            else:
                corpus = rng.choice(DEMO_CORPORA_REJECTED)
                risk_label = "违规"
            title_risk = risk_label

            material = Material(
                title=f"{DEMO_PREFIX} {title_risk} · {submitted_at:%Y-%m-%d %H:%M} #{i}",
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
                file_size=len(corpus.encode("utf-8")),
                text_body=corpus,
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

            # v8 fix: seed no longer invents AI hits. The machine_result is
            # written in a "pending LLM run" state so the UI clearly shows the
            # task as "not yet machine-reviewed" rather than risk_level="无风险"
            # with a fake-looking "DEMO" summary. The real LLM will write
            # genuine hits when the operator re-triggers via the workflow UI.
            #
            # We still emit the analytics-shape fields (risk_level =
            # "无风险", sensitive_level = "S0", hits = []) so dashboards built
            # on top of this data keep working — those generators only look
            # at LLM hits, and 0 hits == "尚未审核".
            risk = "无风险"

            final_human = (
                MaterialStatus.REJECTED
                if final_status in (MaterialStatus.REJECTED, MaterialStatus.WITHDRAWN)
                else MaterialStatus.APPROVED
            )

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
                title=f"{DEMO_PREFIX} task #{material.id} ({risk_label})",
                review_type=ReviewType.HUMAN,
                final_decision=final_dec,
                # Status set to PENDING with machine_started_at/completed_at NULL
                # so the UI renders "no result yet" and frontend prompts the
                # operator to execute AI review.
                machine_status=MachineStatus.PENDING,
                machine_result=None,
                machine_started_at=None,
                machine_completed_at=None,
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
    _require_reseed_allowed()
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
    p = argparse.ArgumentParser(description="Seed analytics demo data", allow_abbrev=False)
    p.add_argument("--days", type=int, default=30, help="Number of days of history")
    p.add_argument("--limit", type=int, default=3000, help="Max total materials")
    p.add_argument(
        "--reset",
        action="store_true",
        help="Delete any existing __ANALYTICS_DEMO__ rows before generating",
    )
    p.add_argument("--reason", required=True, help="Audit reason for the run")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()

    async def _run() -> None:
        try:
            await main(days=args.days, limit=args.limit, reset=args.reset)
        finally:
            await engine.dispose()

    asyncio.run(_run())
