"""Inspection result query router."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from io import StringIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import String, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.deps import require_roles
from app.db.session import get_db
from app.models.material import Material, MaterialType
from app.models.review import (
    ReviewAssignment,
    ReviewAssignmentTag,
    ReviewDecision,
    ReviewTask,
)
from app.models.user import User
from app.schemas.query import (
    AdvancedCondition,
    DECISION_LABELS,
    MachineHitOut,
    MachineReviewRecordOut,
    QueryLabelsOut,
    QueryPage,
    RISK_TO_DECISION,
)

router = APIRouter(prefix="/query", tags=["query"])

MAX_EXPORT_ROWS = 50_000
MAX_PAGE_SIZE = 100


def _enum_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "value"):
        return value.value
    return str(value)


def _to_record(
    task: ReviewTask,
    material: Optional[Material],
    submitter: Optional[User],
    assignee: Optional[User],
    tag_snapshots: List[Dict[str, Any]],
) -> MachineReviewRecordOut:
    mr: Dict[str, Any] = dict(task.machine_result or {})
    strategy = mr.get("strategy") or {}
    risk_level = mr.get("risk_level")
    if isinstance(risk_level, str):
        machine_decision = RISK_TO_DECISION.get(risk_level)
    else:
        machine_decision = None

    hits: List[MachineHitOut] = []
    hits_raw = mr.get("hits") or []
    if isinstance(hits_raw, list):
        for h in hits_raw:
            if not isinstance(h, dict):
                continue
            try:
                hits.append(MachineHitOut(**h))
            except Exception:
                continue

    strategy_code = strategy.get("code") if isinstance(strategy, dict) else None
    strategy_name = strategy.get("name") if isinstance(strategy, dict) else None
    if not strategy_code:
        strategy_code = task.stage_key or None

    bailian = mr.get("trace_id") or mr.get("bailian_request_id")

    metadata: Dict[str, Any] = {}
    if material is not None and isinstance(material.extra_metadata, dict):
        metadata = material.extra_metadata
    ip = metadata.get("ip")
    account_id = metadata.get("account_id")

    requested_at = task.machine_started_at or task.created_at

    return MachineReviewRecordOut(
        id=task.id,
        title=task.title,
        review_type=_enum_value(task.review_type),
        final_decision=_enum_value(task.final_decision),
        material_id=task.material_id,
        material_version_id=task.material_version_id,
        material_type=_enum_value(material.material_type) if material else None,
        strategy_code=strategy_code,
        strategy_name=strategy_name or strategy_code,
        risk_level=risk_level,
        machine_decision=machine_decision,
        bailian_request_id=bailian,
        ip=ip,
        account_id=account_id,
        submitter_id=submitter.id if submitter else None,
        submitter_name=submitter.full_name if submitter else None,
        assignee_id=assignee.id if assignee else None,
        assignee_name=assignee.full_name if assignee else None,
        hits=hits,
        violation_tags=tag_snapshots,
        summary=mr.get("summary"),
        requested_at=requested_at,
        finished_at=task.machine_completed_at,
    )


def _split_csv(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def _parse_conditions(raw: Optional[str]) -> List[AdvancedCondition]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="conditions 必须是合法 JSON")
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="conditions 必须是 JSON 数组")
    out: List[AdvancedCondition] = []
    for item in data:
        try:
            out.append(AdvancedCondition(**item))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"条件不合法: {exc}")
    if len(out) > 5:
        raise HTTPException(status_code=400, detail="最多 5 个条件")
    return out


def _apply_filters(
    stmt,
    *,
    start,
    end,
    material_types,
    strategy_code,
    machine_decision,
    request_ids,
    task_ids,
    text_contains,
    labels,
    feedback,
    conditions,
):
    if start is not None:
        ts = ReviewTask.machine_started_at
        stmt = stmt.where(or_(ts >= start, and_(ts.is_(None), ReviewTask.created_at >= start)))
    if end is not None:
        ts = ReviewTask.machine_started_at
        stmt = stmt.where(or_(ts <= end, and_(ts.is_(None), ReviewTask.created_at <= end)))
    if material_types:
        stmt = stmt.where(Material.material_type.in_(material_types))
    if request_ids:
        stmt = stmt.where(ReviewTask.id.in_(request_ids))
    if task_ids:
        stmt = stmt.where(ReviewTask.material_version_id.in_(task_ids))
    if feedback is not None:
        stmt = stmt.where(ReviewTask.final_decision == feedback)
    if strategy_code:
        stmt = stmt.where(ReviewTask.machine_result["strategy"]["code"].astext == strategy_code)
    if machine_decision:
        target_risks = [r for r, d in RISK_TO_DECISION.items() if d == machine_decision]
        if target_risks:
            stmt = stmt.where(ReviewTask.machine_result["risk_level"].astext.in_(target_risks))
    if labels:
        for lbl in labels:
            stmt = stmt.where(
                func.cast(ReviewTask.machine_result, String).ilike(f"%{lbl}%")
            )
    if text_contains:
        like = f"%{text_contains}%"
        stmt = stmt.where(
            or_(
                ReviewTask.title.ilike(like),
                func.cast(ReviewTask.machine_result, String).ilike(like),
            )
        )
    for c in conditions:
        needle = f"%{c.value}%"
        if c.op == "contains":
            stmt = stmt.where(func.cast(ReviewTask.machine_result, String).ilike(needle))
        else:
            stmt = stmt.where(~func.cast(ReviewTask.machine_result, String).ilike(needle))
    return stmt


async def _run_query(
    db: AsyncSession,
    *,
    start,
    end,
    material_types,
    strategy_code,
    machine_decision,
    request_ids,
    task_ids,
    text_contains,
    labels,
    feedback,
    conditions,
    page: int,
    size: int,
) -> List[MachineReviewRecordOut]:
    Submitter = aliased(User, name="submitter")
    Assignee = aliased(User, name="assignee")

    stmt = (
        select(ReviewTask, Material, Submitter, Assignee)
        .join(Material, Material.id == ReviewTask.material_id)
        .outerjoin(Submitter, Submitter.id == Material.submitter_id)
        .outerjoin(
            ReviewAssignment,
            and_(
                ReviewAssignment.task_id == ReviewTask.id,
                ReviewAssignment.decision != ReviewDecision.PENDING,
            ),
        )
        .outerjoin(Assignee, Assignee.id == ReviewAssignment.assignee_id)
    )
    stmt = _apply_filters(
        stmt,
        start=start,
        end=end,
        material_types=material_types,
        strategy_code=strategy_code,
        machine_decision=machine_decision,
        request_ids=request_ids,
        task_ids=task_ids,
        text_contains=text_contains,
        labels=labels,
        feedback=feedback,
        conditions=conditions,
    )
    stmt = stmt.order_by(ReviewTask.id.desc()).offset((page - 1) * size).limit(size)

    rows = (await db.execute(stmt)).all()
    if not rows:
        return []

    task_ids_out = [t.id for t, _, _, _ in rows]
    tag_stmt = (
        select(ReviewAssignmentTag.tag_id, ReviewAssignmentTag.tag_snapshot, ReviewAssignment.task_id)
        .join(ReviewAssignment, ReviewAssignment.id == ReviewAssignmentTag.assignment_id)
        .where(ReviewAssignment.task_id.in_(task_ids_out))
    )
    tag_rows = (await db.execute(tag_stmt)).all()
    tags_by_task: Dict[int, List[Dict[str, Any]]] = {}
    for tag_id, snap, task_id in tag_rows:
        tags_by_task.setdefault(task_id, []).append({"id": tag_id, "snapshot": snap})

    out: List[MachineReviewRecordOut] = []
    for task, material, submitter, assignee in rows:
        out.append(_to_record(task, material, submitter, assignee, tags_by_task.get(task.id, [])))
    return out


@router.get("/results", response_model=QueryPage)
async def list_results(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    start: Optional[datetime] = Query(None, description="请求时间 ≥ start"),
    end: Optional[datetime] = Query(None, description="请求时间 ≤ end"),
    material_types: List[MaterialType] = Query(
        default_factory=list, description="检测模态多选"
    ),
    strategy_code: Optional[str] = Query(None, description="审核策略 code"),
    machine_decision: Optional[str] = Query(
        None, pattern="^(block|review|pass)$", description="机审检测结果"
    ),
    request_ids: Optional[str] = Query(None, description="英文逗号分隔的 Request ID"),
    task_ids: Optional[str] = Query(None, description="英文逗号分隔的 Task ID"),
    text_contains: Optional[str] = Query(None, description="文本内容模糊匹配"),
    labels: List[str] = Query(default_factory=list, description="返回标签多选"),
    feedback: Optional[ReviewDecision] = Query(None, description="反馈结果"),
    conditions: Optional[str] = Query(None, description="高级条件 JSON"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
) -> QueryPage:
    req_ids = [int(x) for x in _split_csv(request_ids)]
    t_ids = [int(x) for x in _split_csv(task_ids)]
    conds = _parse_conditions(conditions)

    base_count = select(func.count(ReviewTask.id)).join(Material, Material.id == ReviewTask.material_id)
    base_count = _apply_filters(
        base_count,
        start=start,
        end=end,
        material_types=material_types,
        strategy_code=strategy_code,
        machine_decision=machine_decision,
        request_ids=req_ids,
        task_ids=t_ids,
        text_contains=text_contains,
        labels=labels,
        feedback=feedback,
        conditions=conds,
    )
    total = await db.scalar(base_count) or 0

    items = await _run_query(
        db,
        start=start,
        end=end,
        material_types=material_types,
        strategy_code=strategy_code,
        machine_decision=machine_decision,
        request_ids=req_ids,
        task_ids=t_ids,
        text_contains=text_contains,
        labels=labels,
        feedback=feedback,
        conditions=conds,
        page=page,
        size=size,
    )
    return QueryPage(items=items, total=total, page=page, size=size)


@router.get("/results/export.csv")
async def export_results(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    material_types: List[MaterialType] = Query(default_factory=list),
    strategy_code: Optional[str] = Query(None),
    machine_decision: Optional[str] = Query(None, pattern="^(block|review|pass)$"),
    request_ids: Optional[str] = Query(None),
    task_ids: Optional[str] = Query(None),
    text_contains: Optional[str] = Query(None),
    labels: List[str] = Query(default_factory=list),
    feedback: Optional[ReviewDecision] = Query(None),
    conditions: Optional[str] = Query(None),
) -> StreamingResponse:
    req_ids = [int(x) for x in _split_csv(request_ids)]
    t_ids = [int(x) for x in _split_csv(task_ids)]
    conds = _parse_conditions(conditions)

    all_items: List[MachineReviewRecordOut] = []
    cursor = 1
    while len(all_items) < MAX_EXPORT_ROWS:
        batch = await _run_query(
            db,
            start=start,
            end=end,
            material_types=material_types,
            strategy_code=strategy_code,
            machine_decision=machine_decision,
            request_ids=req_ids,
            task_ids=t_ids,
            text_contains=text_contains,
            labels=labels,
            feedback=feedback,
            conditions=conds,
            page=cursor,
            size=MAX_PAGE_SIZE,
        )
        if not batch:
            break
        all_items.extend(batch)
        if len(batch) < MAX_PAGE_SIZE:
            break
        cursor += 1

    if len(all_items) > MAX_EXPORT_ROWS:
        raise HTTPException(
            status_code=400,
            detail=f"导出结果超过 {MAX_EXPORT_ROWS} 行，请缩小时间范围或筛选条件",
        )

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Request ID",
        "Task ID",
        "策略名称",
        "检测模态",
        "风险等级",
        "检测结果",
        "反馈结果",
        "命中标签",
        "置信度",
        "请求时间",
        "完成时间",
        "提交用户",
        "审核人",
        "IP",
        "AccountId",
        "BailianRequestId",
    ])
    for r in all_items:
        labels_text = " | ".join(
            h.label_cn or h.label or "" for h in r.hits if h.label_cn or h.label
        )
        scores_text = " | ".join(
            f"{h.score:.2f}" for h in r.hits if h.score is not None
        )
        writer.writerow([
            r.id,
            r.material_version_id or "",
            r.strategy_name or "",
            r.material_type or "",
            r.risk_level or "",
            DECISION_LABELS.get(r.machine_decision or "", ""),
            r.final_decision or "",
            labels_text,
            scores_text,
            r.requested_at.isoformat() if r.requested_at else "",
            r.finished_at.isoformat() if r.finished_at else "",
            r.submitter_name or "",
            r.assignee_name or "",
            r.ip or "",
            r.account_id or "",
            r.bailian_request_id or "",
        ])
    buf.seek(0)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="adreview-result-{stamp}.csv"'},
    )


@router.get("/labels", response_model=QueryLabelsOut)
async def list_labels(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
) -> QueryLabelsOut:
    stmt = select(ReviewTask.machine_result).where(ReviewTask.machine_result.is_not(None))
    rows = (await db.execute(stmt)).all()
    seen: set[str] = set()
    for (raw,) in rows:
        if not raw:
            continue
        hits = raw.get("hits") if isinstance(raw, dict) else None
        if not isinstance(hits, list):
            continue
        for h in hits:
            if not isinstance(h, dict):
                continue
            lbl = h.get("label_cn") or h.get("label")
            if lbl:
                seen.add(str(lbl))
    return QueryLabelsOut(labels=sorted(seen))


@router.get("/strategies")
async def list_strategies(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("reviewer", "mlr", "admin")),
    size: int = Query(500, ge=1, le=500),
):
    """Lightweight read-only projection of strategies for the query filter."""
    from app.models.strategy import Strategy

    stmt = (
        select(Strategy.id, Strategy.code, Strategy.name, Strategy.scope, Strategy.is_active)
        .where(Strategy.is_active.is_(True))
        .order_by(Strategy.scope.asc(), Strategy.id.asc())
        .limit(size)
    )
    rows = (await db.execute(stmt)).all()
    return {
        "items": [
            {
                "id": r.id,
                "code": r.code,
                "name": r.name,
                "scope": r.scope.value if hasattr(r.scope, "value") else str(r.scope),
                "is_active": r.is_active,
            }
            for r in rows
        ]
    }