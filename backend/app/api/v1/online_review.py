"""Online review (即时检测) router — synchronous detect for inline text.

联动真实审核策略 + 大模型: 加载策略的 services / 启用审核点 / llm_review
配置, 跑本地词库匹配 (平台库 ∪ 策略关联库) + 大模型审核 (按策略选定模型或
回退全局 MAAS), 聚合风险等级后返回.

结果统一落 review_tasks (与素材入库→工作流审核共享同一张表), 让审核结果
查询 (/query) 和数据报表 (/reports) 能直接读到在线审核数据. 每次检测创建
一条占位 Material + MaterialVersion + WorkflowInstance + ReviewTask.

响应契约 (前后端一致, 无 mock 占位):
  {
    conclusion, conclusionType, log_id, latency_ms,
    strategy: {id, name} | null,
    engines_used: ["wordset"] | ["wordset", "llm"],
    model: str | null,
    llm_error: str | null,
    data: [{ msg, conclusion, hits: [...] }]
  }
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.human_review_config import RiskLevel
from app.models.user import User

router = APIRouter(prefix="/online-review", tags=["online-review"])
log = logging.getLogger(__name__)


class OnlineReviewItem(BaseModel):
    kind: str = Field(default="text", description="file | text")
    name: str = ""
    text: Optional[str] = None


class OnlineReviewRequest(BaseModel):
    strategy_id: Optional[int] = None
    media_type: str = Field(default="text", description="text | image | video")
    mode: str = Field(default="single", description="single | bulk")
    items: List[OnlineReviewItem] = Field(default_factory=list)


class OnlineReviewHit(BaseModel):
    source: str
    position: Optional[int] = None
    matched_text: Optional[str] = None
    risk_level: str
    rule_code: str
    rule_label: str


class OnlineReviewDataItem(BaseModel):
    msg: str
    conclusion: str
    hits: List[OnlineReviewHit]


class StrategyBrief(BaseModel):
    id: int
    name: str


class OnlineReviewResponse(BaseModel):
    conclusion: str
    log_id: int
    conclusionType: int  # 1 = 合规, 2 = 不合规
    data: List[OnlineReviewDataItem]
    latency_ms: int
    strategy: Optional[StrategyBrief] = None
    engines_used: List[str] = Field(default_factory=list)
    model: Optional[str] = None
    llm_error: Optional[str] = None


def _risk_level_to_conclusion(risk_level: str) -> Tuple[str, int]:
    """risk_level -> (conclusion 文案, conclusionType)。"""
    if risk_level in (RiskLevel.HIGH.value, RiskLevel.MEDIUM.value, RiskLevel.SENSITIVE.value):
        return ("不合规", 2)
    return ("合规", 1)


def _hit_to_response(hit: Dict[str, Any]) -> OnlineReviewHit:
    label = hit.get("label") or hit.get("label_cn") or "unknown"
    label_cn = hit.get("label_cn") or label
    risk = hit.get("risk") or hit.get("risk_level") or RiskLevel.LOW.value
    source = hit.get("source") or "rules"
    quote = hit.get("quote") or hit.get("matched_text")
    return OnlineReviewHit(
        source=f"rules.{source}" if not source.startswith("rules.") else source,
        position=hit.get("position"),
        matched_text=quote,
        risk_level=risk,
        rule_code=str(label).upper(),
        rule_label=label_cn,
    )


# ---------------------------------------------------------------------------
# 策略解析
# ---------------------------------------------------------------------------


async def _load_strategy(
    db: AsyncSession, strategy_id: Optional[int]
) -> Tuple[Optional[Any], Optional[int]]:
    """根据 strategy_id 加载策略; 未传则兜底 default 单例.

    返回 (strategy_obj, strategy_id_or_none_for_brief). 不存在 / 未激活时:
      - 显式传入的 id 不存在 → 404
      - default 单例缺失 → 返回 (None, None) 让调用方走裸服务兜底
    """
    from app.models.strategy import Strategy, StrategyScope

    if strategy_id:
        strat = await db.get(Strategy, strategy_id)
        if not strat or not strat.is_active:
            raise HTTPException(
                status_code=404, detail=f"策略 {strategy_id} 不存在或未激活"
            )
        return strat, strat.id

    # 未传 → default 单例
    row = await db.execute(
        select(Strategy).where(Strategy.scope == StrategyScope.DEFAULT.value)
    )
    strat = row.scalar_one_or_none()
    if strat and strat.is_active:
        return strat, strat.id
    return None, None


def _services_from_strategy(strat: Optional[Any]) -> List[str]:
    """从 strategy.definition.services 取服务 code 列表; 兜底 text_detection_pro."""
    if strat and strat.definition:
        svcs = (
            strat.definition.get("services")
            if isinstance(strat.definition, dict)
            else None
        )
        if isinstance(svcs, list) and svcs:
            return [s.get("code") if isinstance(s, dict) else s for s in svcs if s]
    return ["text_detection_pro"]


def _llm_review_config(strat: Optional[Any]) -> Tuple[bool, Optional[int]]:
    """读 strategy.definition.llm_review → (is_enabled, model_id)."""
    if not strat or not strat.definition:
        return False, None
    cfg = strat.definition.get("llm_review") if isinstance(strat.definition, dict) else None
    if not isinstance(cfg, dict):
        return False, None
    return bool(cfg.get("is_enabled")), (
        cfg.get("model_id") if isinstance(cfg.get("model_id"), int) else None
    )


async def _load_strategy_audit_points(
    db: AsyncSession, strat: Optional[Any]
) -> List[Dict[str, Any]]:
    """加载策略启用审核点 (供 LLM prompt 注入).

    走 strategy_points 表取启用的 point_id, 再批量查 AuditPoint 取
    code/label_cn/description/risk_level. 策略为 None 或无勾选 → 返回 [].
    """
    if not strat:
        return []
    from app.models.audit_point import AuditPoint
    from app.models.strategy_point import StrategyPoint

    rows = await db.execute(
        select(StrategyPoint.point_id).where(
            StrategyPoint.strategy_id == strat.id,
            StrategyPoint.is_enabled.is_(True),
        )
    )
    point_ids = [r[0] for r in rows.all() if r[0]]
    if not point_ids:
        return []
    ap_rows = await db.execute(
        select(AuditPoint).where(AuditPoint.id.in_(point_ids))
    )
    out: List[Dict[str, Any]] = []
    for ap in ap_rows.scalars():
        risk = getattr(ap, "risk_level", None)
        risk_val = risk.value if hasattr(risk, "value") else (str(risk) if risk else None)
        out.append(
            {
                "code": ap.code,
                "label_cn": ap.label_cn,
                "description": ap.description,
                "risk_level": risk_val,
                "medium_threshold": ap.medium_threshold,
                "high_threshold": ap.high_threshold,
            }
        )
    return out


async def _load_strategy_linked_library_ids(
    db: AsyncSession, strat: Optional[Any]
) -> Optional[set[int]]:
    """收集策略勾选审核点/项关联的 word 库 id.

    返回 None 表示策略为 None (调用方应回退全量); 返回 set (可能空) 表示策略
    已解析, 词库范围 = 平台库 ∪ 该集合.
    """
    if not strat:
        return None
    from app.models.audit_item_library import AuditItemLibrary
    from app.models.audit_point_library import AuditPointLibrary
    from app.models.library import LibraryType
    from app.models.strategy_item import StrategyItem
    from app.models.strategy_point import StrategyPoint

    # 启用的 point_id / item_id
    pt_rows = await db.execute(
        select(StrategyPoint.point_id).where(
            StrategyPoint.strategy_id == strat.id,
            StrategyPoint.is_enabled.is_(True),
        )
    )
    point_ids = [r[0] for r in pt_rows.all() if r[0]]
    it_rows = await db.execute(
        select(StrategyItem.item_id).where(
            StrategyItem.strategy_id == strat.id,
            StrategyItem.is_enabled.is_(True),
        )
    )
    item_ids = [r[0] for r in it_rows.all() if r[0]]

    linked: set[int] = set()
    if point_ids:
        # 仅取 word 类型库, 与 match_active_words 的口径一致
        lib_rows = await db.execute(
            select(AuditPointLibrary.library_id).where(
                AuditPointLibrary.audit_point_id.in_(point_ids)
            )
        )
        linked.update(r[0] for r in lib_rows.all() if r[0])
    if item_ids:
        lib_rows = await db.execute(
            select(AuditItemLibrary.library_id).where(
                AuditItemLibrary.audit_item_id.in_(item_ids)
            )
        )
        linked.update(r[0] for r in lib_rows.all() if r[0])

    if not linked:
        return set()
    # 过滤为 word 库 (避免把 image/reply 库 id 带进 wordset_matcher)
    from app.models.library import Library

    lib_rows = await db.execute(
        select(Library.id).where(
            Library.id.in_(linked),
            Library.library_type == LibraryType.WORD.value,
        )
    )
    return {r[0] for r in lib_rows.all() if r[0]}


# ---------------------------------------------------------------------------
# 大模型调用 (策略化)
# ---------------------------------------------------------------------------


async def _run_llm_detection(
    db: AsyncSession,
    *,
    text_body: str,
    enabled_services: List[str],
    audit_points: List[Dict[str, Any]],
    llm_enabled: bool,
    model_id: Optional[int],
) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str], Optional[str]]:
    """执行大模型检测 (策略化).

    返回 (hits, model_name, llm_error, correlation_id):
      - llm 未开启 → ([], None, None, None)
      - 开启但未配置/解析失败 → ([], None, error_msg, None)
      - 开启且调用失败 → ([], model_name, error_msg, correlation_id)
      - 开启且成功 → (hits, model_name, None, correlation_id)
    任何失败都不抛出, 由调用方降级为纯词库结果 + 显式标注.
    correlation_id 用于落 review_tasks.machine_result 关联 llm_calls 遥测.
    """
    if not llm_enabled:
        return [], None, None, None
    if not text_body or not text_body.strip():
        return [], None, None, None

    from app.services.llm.resolver import resolve_llm_client

    client, model_name, resolve_err = await resolve_llm_client(db, model_id)
    if not client:
        return [], None, resolve_err or "大模型客户端未就绪", None

    correlation_id = uuid.uuid4().hex
    try:
        result, _audit_meta = await client.moderate(
            db=db,
            version_id=None,  # 在线试检测不绑 material_version; llm_calls.version_id 可空
            task_id=None,  # 同上, 可空 — 避免 FK=0 落库失败
            text_body=text_body,
            enabled_services=enabled_services,
            correlation_id=correlation_id,
            audit_points=audit_points,
        )
        hits = _llm_result_to_hits(result, enabled_services)
        return hits, model_name, None, correlation_id
    except Exception as exc:
        log.warning(
            "online-review llm detection failed corr=%s: %s", correlation_id, exc
        )
        return [], model_name, f"大模型调用失败: {exc}", correlation_id


def _llm_result_to_hits(
    result: Any, enabled_services: List[str]
) -> List[Dict[str, Any]]:
    """Coerce the LLM ModerationResult into the hit-dict shape (与 machine_review 对齐)."""
    hits: List[Dict[str, Any]] = []
    for hit in result.hits:
        hits.append(
            {
                "service_code": hit.service_code or (
                    enabled_services[0] if enabled_services else "text_detection_pro"
                ),
                "service_name": hit.service_name or "MaaS Moderation",
                "audit_point_code": getattr(hit, "audit_point_code", "") or "",
                "label": hit.label,
                "label_cn": hit.label_cn,
                "score": max(0.0, min(1.0, float(hit.score))),
                "quote": hit.quote,
                "bbox": None,
                "page": None,
                "timestamp_ms": None,
                "sensitive_grade": _normalize_grade(hit.sensitive_grade),
                "risk": (hit.risk or "").strip() or None,
                "source": "llm",
            }
        )
    return hits


def _normalize_grade(grade: Optional[str]) -> str:
    if grade in {"S0", "S1", "S2", "S3"}:
        return grade
    return "S0"


# ---------------------------------------------------------------------------
# 落库: 创建占位 Material + ReviewTask
# ---------------------------------------------------------------------------

# 占位 workflow template code, 对应 auto_only 模板 (仅机审, 无人审).
# 若模板不存在则跳过 workflow_instance 创建, 仅建 Material + ReviewTask.
_PLACEHOLDER_TEMPLATE_CODE = "auto_only"


async def _persist_to_review_task(
    db: AsyncSession,
    *,
    user: User,
    strategy_id: Optional[int],
    media_type: str,
    model_name: Optional[str],
    engines_used: List[str],
    conclusion: str,
    conclusion_type: int,
    risk_level: str,
    hits: List[Dict[str, Any]],
    llm_error: Optional[str],
    latency_ms: int,
    correlation_id: Optional[str],
    input_items: List[OnlineReviewItem],
    input_preview: str,
) -> int:
    """将在线审核结果落 review_tasks (统一审核结果存储).

    创建占位 Material + MaterialVersion + (可选) WorkflowInstance + ReviewTask,
    machine_result 与 machine_review.py 写入的 schema 对齐, 让 /query 和
    /reports 能直接读到. 返回 review_task.id.
    """
    from app.models.material import (
        Material,
        MaterialStatus,
        MaterialType,
        MaterialVersion,
    )
    from app.models.review import (
        MachineStatus,
        ReviewTask,
        ReviewType,
    )

    # media_type -> MaterialType 映射
    type_map = {
        "text": MaterialType.TEXT,
        "image": MaterialType.IMAGE,
        "video": MaterialType.VIDEO,
        "document": MaterialType.DOCUMENT,
    }
    mat_type = type_map.get(media_type, MaterialType.TEXT)

    # preview 截到 200 字 (用于 material.title)
    preview = (input_preview or "")[:200] or "在线审核"
    now = datetime.now(timezone.utc)

    # 1) 占位 Material
    material = Material(
        title=preview,
        material_type=mat_type,
        status=MaterialStatus.IN_REVIEW,
        submitter_id=user.id,
        extra_metadata={
            "source": "online_review",
            "engines_used": engines_used,
            "conclusion": conclusion,
            "conclusion_type": conclusion_type,
            "llm_error": llm_error,
            "latency_ms": latency_ms,
        },
    )
    db.add(material)
    await db.flush()

    # 2) 占位 MaterialVersion (text_body 存完整输入文本)
    version = MaterialVersion(
        material_id=material.id,
        version_no=1,
        storage_key=f"online-review/{material.id}",
        original_filename=preview[:255],
        mime_type="text/plain",
        file_size=len(input_preview.encode("utf-8")) if input_preview else 0,
        text_body=input_preview,
        created_by_id=user.id,
    )
    db.add(version)
    await db.flush()
    material.current_version_id = version.id

    # 3) WorkflowInstance — review_tasks.workflow_instance_id 是 NOT NULL,
    # 必须建. 用 auto_only 模板 (仅机审单阶段).
    from app.services.workflow_engine import get_template_by_code

    template = await get_template_by_code(db, _PLACEHOLDER_TEMPLATE_CODE)
    if not template:
        raise HTTPException(
            status_code=500,
            detail=f"workflow template '{_PLACEHOLDER_TEMPLATE_CODE}' not found",
        )
    stage_key = "ai_scan"
    from app.models.workflow import WorkflowInstance

    instance = WorkflowInstance(
        material_id=material.id,
        material_version_id=version.id,
        template_id=template.id,
        state="running",
        current_stage_key=stage_key,
    )
    db.add(instance)
    await db.flush()
    instance_id = instance.id

    # 4) ReviewTask — machine_result 与 machine_review.py 对齐
    machine_result: Dict[str, Any] = {
        "risk_level": risk_level,
        "sensitive_level": "S0",
        "hits": hits,
        "rule_hits": [],
        "suggested_action": "review" if conclusion_type == 2 else "pass",
        "summary": (
            f"检测到 {len(hits)} 条命中，风险等级：{risk_level}"
            if hits
            else "未检测到风险内容"
        ),
        "provenance": "online_review",
        "engines_used": engines_used,
        "model": model_name,
        "llm_error": llm_error,
        "correlation_id": correlation_id,
        "conclusion": conclusion,
        "conclusion_type": conclusion_type,
        "latency_ms": latency_ms,
        "input_items": [
            {"kind": it.kind, "name": it.name, "text": it.text}
            for it in input_items
        ],
    }

    task = ReviewTask(
        material_id=material.id,
        material_version_id=version.id,
        workflow_instance_id=instance_id,
        stage_key=stage_key,
        title=preview,
        strategy_id=strategy_id,
        review_type=ReviewType.MACHINE,
        machine_status=MachineStatus.COMPLETED,
        machine_result=machine_result,
        machine_started_at=now,
        machine_completed_at=now,
    )
    db.add(task)
    await db.flush()
    return task.id


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

# 在线审核结果缓存: 相同 (文本+策略+模型) 短期内直接返回, 避免重复调 LLM.
# TTL 10 分钟, 最多 200 条 (LRU 淘汰). 仅缓存成功结果 (llm_error=None).
import hashlib
from datetime import timedelta

_DETECT_CACHE_TTL_SEC = 600
_DETECT_CACHE_MAX = 200
_detect_cache: dict[str, tuple[float, OnlineReviewResponse]] = {}


def _cache_key(text: str, strategy_id: Optional[int], model_id: Optional[int]) -> str:
    raw = f"{text}|{strategy_id}|{model_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def clear_detect_cache() -> None:
    """清空在线审核结果缓存 (测试用)."""
    _detect_cache.clear()


@router.post("/detect", response_model=OnlineReviewResponse)
async def detect(
    body: OnlineReviewRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> OnlineReviewResponse:
    started = time.time()

    # 聚合所有 item 的文本
    texts: List[str] = []
    for it in body.items:
        if it.text:
            texts.append(it.text)
    full_text = "\n".join(texts)

    # 策略解析 (default 单例兜底)
    strat, strat_id_for_brief = await _load_strategy(db, body.strategy_id)
    enabled_services = _services_from_strategy(strat)
    llm_enabled, model_id = _llm_review_config(strat)

    # 缓存命中: 相同 (文本+策略+模型) 在 TTL 内直接返回, 跳过词库+LLM
    ck = _cache_key(full_text, strat.id if strat else None, model_id)
    now_ts = time.time()
    cached = _detect_cache.get(ck)
    if cached and (now_ts - cached[0]) < _DETECT_CACHE_TTL_SEC:
        cached_resp = cached[1]
        # 重新算 latency (展示为缓存命中, 近似 0)
        cached_resp.latency_ms = max(1, int((time.time() - started) * 1000))
        log.info("online-review cache hit key=%s..", ck[:12])
        return cached_resp

    audit_points = await _load_strategy_audit_points(db, strat)
    linked_library_ids = await _load_strategy_linked_library_ids(db, strat)

    hits: List[Dict[str, Any]] = []
    engines_used: List[str] = []

    # 1) 本地词库匹配 (平台库 ∪ 策略关联库; 策略为 None 时全量)
    try:
        from app.services.wordset_matcher import match_active_words

        local_hits = await match_active_words(
            db,
            full_text,
            enabled_services,
            library_ids=linked_library_ids,
        )
        if local_hits:
            hits.extend(local_hits)
        engines_used.append("wordset")
    except Exception as exc:
        log.warning("online-review wordset match failed: %s", exc)

    # 2) 大模型检测 (策略化: 按策略选定模型或回退全局; 失败降级带 llm_error)
    llm_hits, model_name, llm_error, correlation_id = await _run_llm_detection(
        db,
        text_body=full_text,
        enabled_services=enabled_services,
        audit_points=audit_points,
        llm_enabled=llm_enabled,
        model_id=model_id,
    )
    if llm_hits:
        hits.extend(llm_hits)
    if llm_enabled and not llm_error:
        engines_used.append("llm")

    # 聚合风险等级: 命中即高风险 (按需求, 命中直接展示高风险)
    risk_level = RiskLevel.HIGH.value if hits else RiskLevel.NONE.value
    conclusion, conclusion_type = _risk_level_to_conclusion(risk_level)

    data: List[OnlineReviewDataItem] = []
    if hits:
        # 命中的 risk_level 统一为高风险展示
        for h in hits:
            if not h.get("risk") and not h.get("risk_level"):
                h["risk"] = RiskLevel.HIGH.value
        resp_hits = [_hit_to_response(h) for h in hits]
        msg = f"检测到 {len(hits)} 条命中，风险等级：{risk_level}"
        data.append(OnlineReviewDataItem(msg=msg, conclusion=conclusion, hits=resp_hits))
    else:
        msg = "未检测到风险内容"
        data.append(OnlineReviewDataItem(msg=msg, conclusion="合规", hits=[]))

    latency_ms = int((time.time() - started) * 1000)

    strat_brief: Optional[StrategyBrief] = None
    if strat and strat_id_for_brief:
        strat_brief = StrategyBrief(id=strat.id, name=strat.name)

    # 落 review_tasks (统一审核结果存储, /query 和 /reports 直接可读)
    task_id = await _persist_to_review_task(
        db,
        user=user,
        strategy_id=strat.id if strat else None,
        media_type=body.media_type,
        model_name=model_name,
        engines_used=engines_used,
        conclusion=conclusion,
        conclusion_type=conclusion_type,
        risk_level=risk_level,
        hits=hits,
        llm_error=llm_error,
        latency_ms=latency_ms,
        correlation_id=correlation_id,
        input_items=body.items,
        input_preview=full_text,
    )

    # 提交以落 llm_calls 审计行 + review_tasks (record_llm_call 只 flush
    # 不 commit; get_db 依赖不自动 commit, finally 会回滚未提交的事务, 导致
    # 审计行/记录丢失).
    try:
        await db.commit()
    except Exception as exc:
        log.warning("online-review audit commit failed: %s", exc)

    response = OnlineReviewResponse(
        conclusion=conclusion,
        log_id=task_id,
        conclusionType=conclusion_type,
        data=data,
        latency_ms=latency_ms,
        strategy=strat_brief,
        engines_used=engines_used,
        model=model_name,
        llm_error=llm_error,
    )

    # 写缓存: 仅缓存无 LLM 错误的成功结果 (LRU 淘汰)
    if not llm_error:
        if len(_detect_cache) >= _DETECT_CACHE_MAX:
            # 淘汰最旧的一条
            oldest = min(_detect_cache, key=lambda k: _detect_cache[k][0])
            _detect_cache.pop(oldest, None)
        _detect_cache[ck] = (time.time(), response)

    return response


# ---------------------------------------------------------------------------
# 历史记录查询 (列表 / 详情) — 读 review_tasks
# ---------------------------------------------------------------------------


class OnlineReviewListItem(BaseModel):
    id: int
    media_type: str
    conclusion: str
    conclusion_type: int
    risk_level: str
    model: Optional[str] = None
    engines_used: List[str] = Field(default_factory=list)
    latency_ms: int
    input_preview: str
    strategy_id: Optional[int] = None
    llm_error: Optional[str] = None
    created_at: datetime


class OnlineReviewDetail(OnlineReviewListItem):
    hits: List[Dict[str, Any]] = Field(default_factory=list)
    correlation_id: Optional[str] = None
    input_items: List[Dict[str, Any]] = Field(default_factory=list)
    user_id: Optional[int] = None


def _media_type_from_material(mat_type: Any) -> str:
    """MaterialType enum -> online-review media_type string."""
    val = mat_type.value if hasattr(mat_type, "value") else str(mat_type)
    return val


def _extract_from_machine_result(
    mr: Dict[str, Any],
) -> Tuple[str, int, str, Optional[str], List[str], int, Optional[str], Optional[str], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """从 review_task.machine_result 提取在线审核字段.

    返回 (conclusion, conclusion_type, risk_level, model, engines_used,
          latency_ms, llm_error, correlation_id, hits, input_items).
    """
    conclusion = mr.get("conclusion") or "合规"
    conclusion_type = mr.get("conclusion_type") or 1
    risk_level = mr.get("risk_level") or "无风险"
    model = mr.get("model")
    engines_used = mr.get("engines_used") or []
    latency_ms = mr.get("latency_ms") or 0
    llm_error = mr.get("llm_error")
    correlation_id = mr.get("correlation_id")
    hits = mr.get("hits") or []
    input_items = mr.get("input_items") or []
    return (
        conclusion,
        conclusion_type,
        risk_level,
        model,
        engines_used,
        latency_ms,
        llm_error,
        correlation_id,
        hits,
        input_items,
    )


@router.get("/logs", response_model=List[OnlineReviewListItem])
async def list_logs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    media_type: Optional[str] = None,
    strategy_id: Optional[int] = None,
    conclusion: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[OnlineReviewListItem]:
    """在线审核历史记录列表 (按时间倒序).

    从 review_tasks 读取 provenance='online_review' 的记录.
    """
    from app.models.material import Material
    from app.models.review import ReviewTask

    stmt = (
        select(ReviewTask, Material)
        .join(Material, Material.id == ReviewTask.material_id)
        .where(
            ReviewTask.machine_result["provenance"].astext == "online_review"
        )
        .order_by(ReviewTask.created_at.desc())
    )
    if media_type:
        stmt = stmt.where(Material.material_type == media_type)
    if strategy_id:
        stmt = stmt.where(ReviewTask.strategy_id == strategy_id)
    if conclusion:
        # conclusion 存在 machine_result JSONB 里
        stmt = stmt.where(
            ReviewTask.machine_result["conclusion"].astext == conclusion
        )
    stmt = stmt.limit(max(1, min(limit, 200))).offset(max(0, offset))
    rows = (await db.execute(stmt)).all()

    out: List[OnlineReviewListItem] = []
    for task, material in rows:
        mr = dict(task.machine_result or {})
        (
            concl,
            concl_type,
            risk_lvl,
            mdl,
            engines,
            lat_ms,
            llm_err,
            _corr,
            _hits,
            _items,
        ) = _extract_from_machine_result(mr)
        out.append(
            OnlineReviewListItem(
                id=task.id,
                media_type=_media_type_from_material(material.material_type),
                conclusion=concl,
                conclusion_type=concl_type,
                risk_level=risk_lvl,
                model=mdl,
                engines_used=engines,
                latency_ms=lat_ms,
                input_preview=material.title,
                strategy_id=task.strategy_id,
                llm_error=llm_err,
                created_at=task.created_at,
            )
        )
    return out


@router.get("/logs/{log_id}", response_model=OnlineReviewDetail)
async def get_log(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> OnlineReviewDetail:
    """在线审核记录详情 (含完整 hits + 多模态 input_items)."""
    from app.models.material import Material
    from app.models.review import ReviewTask

    row = (
        await db.execute(
            select(ReviewTask, Material)
            .join(Material, Material.id == ReviewTask.material_id)
            .where(ReviewTask.id == log_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    task, material = row

    mr = dict(task.machine_result or {})
    (
        concl,
        concl_type,
        risk_lvl,
        mdl,
        engines,
        lat_ms,
        llm_err,
        corr,
        hits,
        input_items,
    ) = _extract_from_machine_result(mr)

    return OnlineReviewDetail(
        id=task.id,
        media_type=_media_type_from_material(material.material_type),
        conclusion=concl,
        conclusion_type=concl_type,
        risk_level=risk_lvl,
        model=mdl,
        engines_used=engines,
        latency_ms=lat_ms,
        input_preview=material.title,
        strategy_id=task.strategy_id,
        llm_error=llm_err,
        created_at=task.created_at,
        hits=hits,
        correlation_id=corr,
        input_items=input_items,
        user_id=material.submitter_id,
    )
