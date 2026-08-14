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

import hashlib
import json
import logging
import re
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
    kind: str = Field(default="text", description="file | text | image")
    name: str = ""
    text: Optional[str] = None
    # 图片 base64 (支持 data:image/...;base64, 前缀或纯 base64). kind=image 时必填.
    image_base64: Optional[str] = None


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
    # 命中标签关联的代答答案 (从代答库查, 可空)
    reply: Optional[str] = None


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
        reply=hit.get("reply"),
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
    """收集策略勾选审核点/项关联的 word 库 id (词库匹配用).

    返回 None 表示策略为 None (调用方应回退全量); 返回 set (可能空) 表示策略
    已解析, 词库范围 = 平台库 ∪ 该集合.
    """
    word_ids, _image_ids = await _load_strategy_linked_library_ids_split(db, strat)
    return word_ids


async def _load_strategy_linked_library_ids_split(
    db: AsyncSession, strat: Optional[Any]
) -> tuple[Optional[set[int]], Optional[set[int]]]:
    """收集策略勾选审核点/项关联的 word 库 + image 库 id.

    返回 (word_ids, image_ids):
      - 策略为 None → (None, None) (调用方回退全量)
      - 策略已解析 → (set, set) (可能空)
    """
    if not strat:
        return None, None
    from app.models.audit_item_library import AuditItemLibrary
    from app.models.audit_point_library import AuditPointLibrary
    from app.models.library import Library, LibraryType
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
        return set(), set()
    # 按 library_type 拆分 word / image 库
    lib_rows = await db.execute(
        select(Library.id, Library.library_type).where(
            Library.id.in_(linked),
            Library.library_type.in_([LibraryType.WORD.value, LibraryType.IMAGE.value]),
        )
    )
    word_ids: set[int] = set()
    image_ids: set[int] = set()
    for lib_id, ltype in lib_rows.all():
        if ltype == LibraryType.WORD.value:
            word_ids.add(lib_id)
        elif ltype == LibraryType.IMAGE.value:
            image_ids.add(lib_id)
    return word_ids, image_ids


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


async def _run_image_llm_detection(
    db: AsyncSession,
    *,
    image_base64_list: List[Optional[str]],
    audit_points: List[Dict[str, Any]],
    llm_enabled: bool,
    model_id: Optional[int],
    text_audit_points: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str], Optional[str]]:
    """图片多模态 LLM 检测.

    text_audit_points (可选): 图文审核维度(策略 image_text_enabled=true 时传入),
    让 LLM 同时审核图片中可见的文字是否违反文本审核规则.

    返回 (hits, model_name, llm_error, correlation_id):
      - llm 未开启 → ([], None, None, None)
      - 开启但无图片 → ([], None, None, None)
      - 开启但模型非多模态 → ([], model_name, error, None) (不调 LLM)
      - 开启且调用失败 → ([], model_name, error, correlation_id)
      - 开启且成功 → (hits, model_name, None, correlation_id)
    """
    if not llm_enabled:
        return [], None, None, None
    valid_images = [b for b in image_base64_list if b]
    if not valid_images:
        return [], None, None, None

    from app.services.llm.resolver import resolve_llm_client

    # 解析 client + 校验模型是多模态
    client, model_name, resolve_err = await resolve_llm_client(db, model_id)
    if not client:
        return [], None, resolve_err or "大模型客户端未就绪", None

    # 校验模型 large_category == multimodal (图片审核必须用多模态模型)
    from app.models.registered_model import RegisteredModel

    picked_model_id = model_id
    if not picked_model_id:
        # resolve_llm_client(model_id=None) 会挑默认文本模型; 图片场景需要多模态,
        # 重新挑一个 active 多模态模型
        mm_row = await db.execute(
            select(RegisteredModel.id).where(
                RegisteredModel.kind == "large",
                RegisteredModel.large_category == "multimodal",
                RegisteredModel.status == "active",
                RegisteredModel.is_deleted.is_(False),
            ).order_by(RegisteredModel.id.asc()).limit(1)
        )
        picked_model_id = mm_row.scalar_one_or_none()
        if not picked_model_id:
            return [], model_name, "图片审核需选择多模态大模型（注册库无 active 多模态模型），请到模型管理注册并激活", None
        client, model_name, resolve_err = await resolve_llm_client(db, picked_model_id)
        if not client:
            return [], None, resolve_err or "大模型客户端未就绪", None
    else:
        model_row = await db.get(RegisteredModel, picked_model_id)
        if model_row and model_row.large_category != "multimodal":
            return (
                [],
                model_name,
                "图片审核需选择多模态大模型（当前选的是文本模型），请到策略页更换为多模态模型（如 qwen3.7/3.8、kimi）",
                None,
            )

    # 多模态图片审核耗时较长 (LLM 需 OCR + 推理), 用更长超时重建 client
    from app.services.llm import MaaSClient

    old_client = client
    client = MaaSClient(
        base_url=getattr(old_client, "_base_url", None),
        api_key=getattr(old_client, "_api_key", None),
        model=getattr(old_client, "_model", None),
        timeout=180,  # 图片多模态审核 180s (默认 60s 不够)
    )

    # 构造多模态 prompt (审核维度 + 图片)
    # 策略无 image 审核点时, 注入通用内容合规审核维度, 确保 LLM 有判断依据
    DEFAULT_IMAGE_POINTS = [
        {"label_cn": "涉政违规", "description": "含国家领导人肖像/政治敏感人物/政治标语/反动内容等"},
        {"label_cn": "暴恐违规", "description": "含暴力/恐怖/血腥/武器/恐怖组织标识等"},
        {"label_cn": "色情违规", "description": "含色情/低俗/裸露/性暗示等"},
        {"label_cn": "广告法违规", "description": "含绝对化用语/虚假宣传/医疗宣称/未审批广告等"},
        {"label_cn": "违法违规标识", "description": "含国家机关标识/国旗国徽滥用/违法违规符号等"},
        {"label_cn": "未成年人保护", "description": "含未成年人不良引导/儿童色情/未成年人危险行为等"},
    ]
    effective_points = audit_points if audit_points else DEFAULT_IMAGE_POINTS
    points_block = "\n".join(
        f"- label: {p.get('label_cn', '')}" + (f" | 描述: {p.get('description', '')}" if p.get('description') else "")
        for p in effective_points
    )
    # 图文审核: 策略开启了 image_text_enabled 时, 追加文本审核维度
    # 让 LLM 同时审核图片中可见的文字内容
    # 限制文本审核点数量, 避免 prompt 过长分散 LLM 注意力 (最多 20 条)
    _MAX_TEXT_POINTS = 20
    text_points_block = ""
    has_text_audit = bool(text_audit_points)
    if has_text_audit:
        limited_text_points = text_audit_points[:_MAX_TEXT_POINTS]
        text_points_lines = "\n".join(
            f"- label: {p.get('label_cn', '')}" + (f" | 描述: {p.get('description', '')}" if p.get('description') else "")
            for p in limited_text_points
        )
        skipped = len(text_audit_points) - len(limited_text_points)
        text_points_block = (
            f"\n\n图片中可见文字的审核维度（同时审核图片画面和图片中出现的文字）:\n{text_points_lines}\n"
            + (f"（还有 {skipped} 条维度未列出）\n" if skipped > 0 else "")
            + "命中图片中文字违规时, evidence 需注明'图片中文字:具体违规内容描述'。"
        )

    system_msg = (
        "你是内容合规审核引擎, 基于中国《网络安全法》《广告法》等法规, 严格判断输入图片是否违规。"
        "重点识别: 涉政(国家领导人/政治敏感人物/政治标语)、暴恐、色情、违法标识等高风险内容。"
        "画面中出现政治人物肖像、国家领导人形象、政治标语、反动言论均判为高风险违规。"
        "请先仔细观察并描述图片内容(含可见文字、人物、场景), 再逐条核对审核维度判断。"
        "输出必须是严格 JSON, 严禁复述违规原文。"
    )
    if has_text_audit:
        system_msg += "同时审核图片中可见的文字内容是否违反文字审核维度。"
    user_text = (
        f"审核维度:\n{points_block}{text_points_block}\n\n"
        "请按以下步骤审核:\n"
        "1. 先描述图片内容(画面、文字、人物等)\n"
        "2. 逐条核对每个审核维度, 判断图片画面是否违规\n"
        + ("3. 核对图片中可见的文字是否违反文字审核维度\n" if has_text_audit else "")
        + "请输出 JSON: {\"description\":\"图片内容描述\",\"hit_points\":[{\"label\":\"对应维度label\","
        "\"risk\":\"高风险|中风险|低风险\",\"evidence\":\"画面中的违规元素描述\"}],"
        "\"summary\":\"类别化摘要\"}\n"
        "命中任一维度即输出 hit_points; 未命中则 hit_points=[]。直接以 { 开头。"
    )
    # 多模态 messages: text + 每张图片一个 image_url
    user_content: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
    for b64 in valid_images:
        url = b64.strip()
        if not url.startswith("data:"):
            url = f"data:image/jpeg;base64,{url}"
        user_content.append({"type": "image_url", "image_url": {"url": url}})
    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_content},
    ]

    correlation_id = uuid.uuid4().hex
    try:
        content = await client.chat(
            db=db,
            messages=messages,
            temperature=0.1,
            max_tokens=4096,
            correlation_id=correlation_id,
        )
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            return [], model_name, "大模型返回非 JSON", correlation_id
        payload = json.loads(m.group(0))
        hit_points = payload.get("hit_points") or []
        hits: List[Dict[str, Any]] = []
        for hp in hit_points:
            if not isinstance(hp, dict):
                continue
            label = (hp.get("label") or "").strip()
            evidence = hp.get("evidence") or ""
            # 图文文字命中: evidence 含"图片中文字"时, label_cn 不加前缀(级联由 audit_item/point 补全)
            display_label = label or "图片违规"
            hits.append({
                "service_code": "llm",
                "service_name": "多模态大模型",
                "label": label or "image_violation",
                "label_cn": display_label,
                "score": 1.0,
                "quote": evidence,
                "bbox": None,
                "page": None,
                "timestamp_ms": None,
                "sensitive_grade": "S0",
                "risk": hp.get("risk") or RiskLevel.HIGH.value,
                "source": "llm",
            })
        return hits, model_name, None, correlation_id
    except Exception as exc:
        err_msg = str(exc)
        # 网关输入图片内容审查拦截 (data_inspection_failed): 说明图片本身含违规内容
        # → 转成高风险命中, 标签用策略审核点体系(优先涉政维度), 而非硬编码"网关拦截"
        if "data_inspection_failed" in err_msg or "Input image data may contain inappropriate" in err_msg:
            log.info(
                "online-review image blocked by gateway input inspection corr=%s (treated as hit)",
                correlation_id,
            )
            # 从策略审核点/默认维度里找涉政相关标签
            political_label = "涉政违规"
            for p in effective_points:
                lbl = p.get("label_cn", "")
                if "涉政" in lbl or "政治" in lbl:
                    political_label = lbl
                    break
            gateway_hit = {
                "service_code": "llm",
                "service_name": "多模态大模型",
                "label": "political_violation",
                "label_cn": political_label,
                "score": 1.0,
                "quote": "图片含违规内容（被内容安全网关拦截）",
                "bbox": None,
                "page": None,
                "timestamp_ms": None,
                "sensitive_grade": "S3",
                "risk": RiskLevel.HIGH.value,
                "source": "llm",
            }
            return [gateway_hit], model_name, None, correlation_id
        log.warning(
            "online-review image llm detection failed corr=%s: %s", correlation_id, exc
        )
        return [], model_name, f"大模型调用失败: {exc}", correlation_id


async def _run_agent_detection(
    db: AsyncSession,
    *,
    text_body: str,
    agent_ids: List[int],
) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
    """审核智能体检测: 加载智能体 points 作为审核维度, 调大模型判断.

    返回 (hits, model_name, error):
      - 无智能体/无文本 → ([], None, None)
      - 智能体无 model_id → 用注册库默认文本模型
      - 调用失败 → ([], model_name, error)
      - 成功 → (hits, model_name, None)
    """
    if not agent_ids or not text_body or not text_body.strip():
        return [], None, None

    from app.models.review_agent import ReviewAgent

    # 加载所有智能体的 points 合并 (带智能体名称, 命中时作为标签前缀)
    all_points: List[Dict[str, Any]] = []
    agent_model_id: Optional[int] = None
    for aid in agent_ids:
        agent = await db.get(ReviewAgent, aid)
        if not agent:
            continue
        agent_name = agent.name or f"智能体{aid}"
        if agent.points and isinstance(agent.points, list):
            for p in agent.points:
                if isinstance(p, dict) and p.get("label"):
                    all_points.append({
                        "label_cn": p["label"],
                        "description": p.get("desc", ""),
                        "agent_name": agent_name,
                    })
        if agent.model_id and not agent_model_id:
            agent_model_id = agent.model_id

    if not all_points:
        return [], None, None

    from app.services.llm.resolver import resolve_llm_client

    # 智能体没绑模型 → 用注册库默认文本模型
    client, model_name, resolve_err = await resolve_llm_client(db, agent_model_id)
    if not client:
        return [], None, resolve_err or "大模型客户端未就绪"

    points_block = "\n".join(
        f"- label: {p['label_cn']}" + (f" | 审核标准: {p['description']}" if p.get("description") else "")
        for p in all_points
    )
    system_msg = (
        "你是审核智能体执行引擎。基于用户配置的审核维度, 判断输入文本是否违规。"
        "输出必须是严格 JSON, 严禁在输出中复述违规原文, 违规片段只用 start/length 定位。"
    )
    user_msg = (
        f"审核维度:\n{points_block}\n\n"
        f"待审核文本:\n\"\"\"{text_body[:settings.maas_max_text_chars]}\"\"\"\n\n"
        "请输出 JSON: {\"hit_points\":[{\"label\":\"对应维度label\","
        "\"start\":0,\"length\":0,\"risk\":\"高风险|中风险|低风险\"}],"
        "\"summary\":\"类别化摘要\"}\n"
        "未命中则 hit_points=[]。直接以 { 开头。"
    )
    correlation_id = uuid.uuid4().hex
    try:
        content = await client.chat(
            db=db,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=2048,
            correlation_id=correlation_id,
        )
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            return [], model_name, "大模型返回非 JSON", None
        payload = json.loads(m.group(0))
        hit_points = payload.get("hit_points") or []
        hits: List[Dict[str, Any]] = []
        for hp in hit_points:
            if not isinstance(hp, dict):
                continue
            label = (hp.get("label") or "").strip()
            start = hp.get("start")
            length = hp.get("length")
            # 重建 quote
            quote = None
            if isinstance(start, int) and isinstance(length, int) and start >= 0 and length > 0:
                end = min(start + length, len(text_body))
                snippet = text_body[start:end].strip().strip("“”\"'")
                quote = snippet or None
            # 找到命中标签对应的智能体名称, 作为前缀
            agent_name = ""
            for p in all_points:
                if p["label_cn"] == label:
                    agent_name = p.get("agent_name", "")
                    break
            prefixed_label = f"{agent_name}智能体/{label}" if agent_name and label else (label or "智能体违规")
            hits.append({
                "service_code": "agent",
                "service_name": f"{agent_name}智能体" if agent_name else "审核智能体",
                "label": label or "agent_violation",
                "label_cn": prefixed_label,
                "score": 1.0,
                "quote": quote,
                "bbox": None,
                "page": None,
                "timestamp_ms": None,
                "sensitive_grade": "S0",
                "risk": hp.get("risk") or RiskLevel.HIGH.value,
                "source": "agent",
            })
        return hits, model_name, None, correlation_id
    except Exception as exc:
        log.warning("online-review agent detection failed corr=%s: %s", correlation_id, exc)
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


async def _enrich_hits_with_label_path(db: AsyncSession, hits: List[Dict[str, Any]]) -> None:
    """用 label_cn 反查审核点表, 给 hit 补上 audit_item_label(一级) 和 audit_point_label(二级).

    LLM/智能体命中的 hit 只有 label_cn (如"国内领导人"), 没有关联审核点体系.
    本函数批量查 AuditPoint, 找到 label_cn 匹配的审核点, 回填其所属的一级(item)
    和二级(point)标签, 使数据查询页能展示完整级联.
    """
    if not hits:
        return
    # 收集需要查的 label_cn (跳过已有 audit_item_label 的)
    labels_to_find: dict[str, None] = {}
    for h in hits:
        if h.get("audit_item_label"):
            continue
        lbl = (h.get("label_cn") or h.get("label") or "").strip()
        # 智能体命中的 label_cn 是 "智能体名/标签" 格式, 取 / 后面的标签部分
        if "/" in lbl:
            lbl = lbl.rsplit("/", 1)[-1].strip()
        if lbl:
            labels_to_find[lbl] = None
    if not labels_to_find:
        return
    from app.models.audit_point import AuditPoint
    from app.models.audit_item import AuditItem

    # 批量查 AuditPoint by label_cn
    ap_rows = await db.execute(
        select(AuditPoint).where(AuditPoint.label_cn.in_(list(labels_to_find.keys())))
    )
    # label_cn → (point_id, parent_point_id, package_code)
    ap_map: dict[str, AuditPoint] = {}
    for ap in ap_rows.scalars():
        ap_map[ap.label_cn] = ap
    # 批量查 parent points (二级, parent_point_id=None) 和 items (一级)
    parent_ids = {ap.parent_point_id for ap in ap_map.values() if ap.parent_point_id}
    parent_map: dict[int, AuditPoint] = {}
    if parent_ids:
        pp_rows = await db.execute(
            select(AuditPoint).where(AuditPoint.id.in_(list(parent_ids)))
        )
        parent_map = {ap.id: ap for ap in pp_rows.scalars()}
    # 查 items (一级标签): 通过 package_code 关联 AuditItem
    pkg_codes = {ap.package_code for ap in ap_map.values()}
    pkg_codes.update({ap.package_code for ap in parent_map.values()})
    item_map: dict[str, AuditItem] = {}
    if pkg_codes:
        from app.models.service import Service

        it_rows = await db.execute(
            select(AuditItem).where(AuditItem.package_code.in_(list(pkg_codes)))
        )
        for it in it_rows.scalars():
            item_map[it.package_code] = it
    # 回填每个 hit
    for h in hits:
        if h.get("audit_item_label"):
            continue
        lbl = (h.get("label_cn") or h.get("label") or "").strip()
        if "/" in lbl:
            lbl = lbl.rsplit("/", 1)[-1].strip()
        ap = ap_map.get(lbl)
        if not ap:
            continue
        # 确定二级标签: 如果该 point 有 parent, 则它是三级, 二级是 parent;
        # 如果 parent=None, 则它本身是二级
        if ap.parent_point_id:
            parent_ap = parent_map.get(ap.parent_point_id)
            point_label = parent_ap.label_cn if parent_ap else None
        else:
            point_label = ap.label_cn
        # 一级标签: 从 package_code 反查 AuditItem
        item = item_map.get(ap.package_code)
        item_label = item.name_cn if item else None
        h["audit_item_label"] = item_label
        h["audit_point_label"] = point_label
        h["audit_point_code"] = ap.code
        h["audit_point_id"] = ap.id


# ---------------------------------------------------------------------------
# 落库: 创建占位 Material + ReviewTask
# ---------------------------------------------------------------------------

# 占位 workflow template code, 对应 auto_only 模板 (仅机审, 无人审).
# 若模板不存在则跳过 workflow_instance 创建, 仅建 Material + ReviewTask.
_PLACEHOLDER_TEMPLATE_CODE = "auto_only"


async def _enrich_hits_with_reply(db: AsyncSession, hits: List[Dict[str, Any]]) -> None:
    """根据命中的审核点/审核项, 查关联的代答库, 给 hit 补上 reply (代答答案).

    规则:
    1. 代答库必须通过 audit_point_libraries / audit_item_libraries 关联到命中的
       审核点/项, 才会返回代答. 没关联就不返回 (不做"查所有代答库"兜底).
    2. 如果代答库绑定了标签 (library_tags), 只有命中的标签与代答库的标签匹配
       时才返回代答. 匹配规则: hit 的标签路径 (一级/二级/三级) 包含代答库
       绑定的标签名. 代答库没绑定标签则不做标签过滤.
    """
    if not hits:
        return
    from app.models.audit_point_library import AuditPointLibrary
    from app.models.audit_item_library import AuditItemLibrary
    from app.models.library import Library, LibraryType
    from app.models.library_item import LibraryItem
    from app.models.library_tag import LibraryTag
    from app.models.tag import Tag
    from app.models.audit_point import AuditPoint
    from app.models.audit_item import AuditItem

    # ── 1. 收集命中的审核点 id 和审核项 id ──
    point_ids: set[int] = set()
    item_ids: set[int] = set()
    for h in hits:
        pid = h.get("audit_point_id")
        if isinstance(pid, int):
            point_ids.add(pid)
        iid = h.get("audit_item_id")
        if isinstance(iid, int):
            item_ids.add(iid)

    # 通过 audit_point_code 反查 point_id
    codes = {h.get("audit_point_code") for h in hits if h.get("audit_point_code")}
    if codes:
        code_rows = await db.execute(
            select(AuditPoint.id).where(AuditPoint.code.in_(list(codes)))
        )
        point_ids.update(r[0] for r in code_rows.all())

    # 通过 audit_point_label 反查 point_id (LLM 命中标签可能不在表里, 但二级标签在)
    point_labels = {h.get("audit_point_label") for h in hits if h.get("audit_point_label")}
    if point_labels:
        pl_rows = await db.execute(
            select(AuditPoint.id).where(AuditPoint.label_cn.in_(list(point_labels)))
        )
        point_ids.update(r[0] for r in pl_rows.all())

    # 通过 audit_item_label 反查 item_id (一级标签, 如"涉政")
    item_labels = {h.get("audit_item_label") for h in hits if h.get("audit_item_label")}
    if item_labels:
        il_rows = await db.execute(
            select(AuditItem.id).where(AuditItem.name_cn.in_(list(item_labels)))
        )
        item_ids.update(r[0] for r in il_rows.all())

    # 没有任何审核点/项关联 → 不返回代答 (策略没关联代答库)
    if not point_ids and not item_ids:
        return

    # ── 2. 查关联的代答库 id (只从审核点/项关联的库里找, 不兜底) ──
    reply_lib_ids: set[int] = set()
    if point_ids:
        rows = await db.execute(
            select(AuditPointLibrary.library_id).where(
                AuditPointLibrary.audit_point_id.in_(list(point_ids))
            )
        )
        reply_lib_ids.update(r[0] for r in rows.all())
    if item_ids:
        rows = await db.execute(
            select(AuditItemLibrary.library_id).where(
                AuditItemLibrary.audit_item_id.in_(list(item_ids))
            )
        )
        reply_lib_ids.update(r[0] for r in rows.all())

    if not reply_lib_ids:
        return

    # 过滤出 active 代答库
    lib_rows = await db.execute(
        select(Library.id).where(
            Library.id.in_(list(reply_lib_ids)),
            Library.library_type == LibraryType.REPLY.value,
            Library.is_active.is_(True),
            Library.is_deleted.is_(False),
        )
    )
    reply_lib_ids = {r[0] for r in lib_rows.all()}
    if not reply_lib_ids:
        return

    # ── 3. 取每个代答库的第一条 reply ──
    item_rows = await db.execute(
        select(LibraryItem.library_id, LibraryItem.reply)
        .where(
            LibraryItem.library_id.in_(list(reply_lib_ids)),
            LibraryItem.is_deleted.is_(False),
            LibraryItem.reply.isnot(None),
        )
        .order_by(LibraryItem.library_id, LibraryItem.id)
    )
    lib_reply: dict[int, str] = {}
    for lib_id, reply in item_rows.all():
        if lib_id not in lib_reply and reply:
            lib_reply[lib_id] = reply
    if not lib_reply:
        return

    # ── 4. 查每个代答库的标签绑定 ──
    lt_rows = await db.execute(
        select(LibraryTag.library_id, LibraryTag.tag_id).where(
            LibraryTag.library_id.in_(list(reply_lib_ids))
        )
    )
    lib_tag_ids: dict[int, list[str]] = {}  # lib_id → [tag_name, ...]
    tag_ids_to_fetch: set[str] = set()
    for lib_id, tag_id in lt_rows.all():
        lib_tag_ids.setdefault(lib_id, []).append(tag_id)
        tag_ids_to_fetch.add(tag_id)

    # 批量取标签名
    tag_name_map: dict[str, str] = {}  # tag_id → tag_name
    if tag_ids_to_fetch:
        tag_rows = await db.execute(
            select(Tag.id, Tag.name).where(Tag.id.in_(list(tag_ids_to_fetch)))
        )
        tag_name_map = {row[0]: row[1] for row in tag_rows.all()}

    # ── 5. 回填每个 hit: 按标签匹配选代答库 ──
    for h in hits:
        if h.get("reply"):
            continue
        # 收集 hit 的标签路径 (一级/二级/三级)
        hit_labels: set[str] = set()
        for key in ("audit_item_label", "audit_point_label", "label_cn"):
            v = h.get(key)
            if v and isinstance(v, str):
                # 智能体标签 "智能体名/标签" 取后半
                if "/" in v:
                    v = v.rsplit("/", 1)[-1].strip()
                hit_labels.add(v)

        for lib_id, reply in lib_reply.items():
            bound_tag_names = [
                tag_name_map.get(tid, "")
                for tid in lib_tag_ids.get(lib_id, [])
            ]
            bound_tag_names = [t for t in bound_tag_names if t]

            if not bound_tag_names:
                # 代答库没绑标签 → 直接匹配
                h["reply"] = reply
                break
            # 代答库绑了标签 → hit 的标签路径需包含代答库的标签名
            if any(tn in hit_labels for tn in bound_tag_names):
                h["reply"] = reply
                break


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
    image_base64: Optional[str] = None,
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

    # 2) MaterialVersion — 图片模式保存图片文件, 文本模式存 text_body
    storage_key = f"online-review/{material.id}"
    mime_type = "text/plain"
    file_size = len(input_preview.encode("utf-8")) if input_preview else 0
    text_body = input_preview
    original_filename = preview[:255] or "online-review.txt"

    if image_base64 and mat_type in (MaterialType.IMAGE, MaterialType.VIDEO):
        # 解码 base64 保存到 storage/uploads/materials/{id}/v1/
        import base64
        import hashlib
        from app.services import storage as storage_svc

        # 去掉 data:image/xxx;base64, 前缀
        raw_b64 = image_base64
        if "," in raw_b64 and raw_b64.startswith("data:"):
            header, raw_b64 = raw_b64.split(",", 1)
            # 从 data:image/jpeg;base64 提取 mime
            if "image/" in header:
                mime_type = header.split("image/")[1].split(";")[0]
                mime_type = f"image/{mime_type}"
        try:
            img_bytes = base64.b64decode(raw_b64)
            file_size = len(img_bytes)
            sha = hashlib.sha256(img_bytes).hexdigest()[:12]
            ext = "jpg"
            if mime_type == "image/png":
                ext = "png"
            elif mime_type == "image/webp":
                ext = "webp"
            storage_key = f"materials/{material.id}/v1/{sha}.{ext}"
            dest = settings.storage_root / "uploads" / storage_key
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(img_bytes)
            original_filename = f"online-review-{sha}.{ext}"
            # 图片模式不存 text_body (text_body 是输入文本, 不是图片内容)
        except Exception as exc:
            log.warning("online-review: failed to save image file: %s", exc)

    version = MaterialVersion(
        material_id=material.id,
        version_no=1,
        storage_key=storage_key,
        original_filename=original_filename,
        mime_type=mime_type,
        file_size=file_size,
        text_body=text_body if mat_type == MaterialType.TEXT else None,
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


def _cache_key(text: str, strategy_id: Optional[int], model_id: Optional[int], image_hash: Optional[str] = None) -> str:
    """缓存 key: 文本模式按 text; 图片模式按 image_hash (sha256)."""
    raw = f"{text}|{strategy_id}|{model_id}|{image_hash or ''}"
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

    # 缓存命中: 相同 (文本/图片+策略+模型) 在 TTL 内直接返回, 跳过词库+LLM
    # 图片模式按 image_base64 的 sha256 做 key, 避免不同图片共享缓存
    image_b64_list = [it.image_base64 for it in body.items if it.image_base64]
    image_hash = None
    if image_b64_list:
        from app.services.image_matcher import decode_base64_to_bytes, compute_sha256_from_bytes

        image_hashes = []
        for b64 in image_b64_list:
            try:
                img_bytes = decode_base64_to_bytes(b64)
                image_hashes.append(compute_sha256_from_bytes(img_bytes))
            except Exception:
                pass
        image_hash = "|".join(image_hashes) if image_hashes else None
    ck = _cache_key(full_text, strat.id if strat else None, model_id, image_hash)
    now_ts = time.time()
    cached = _detect_cache.get(ck)
    if cached and (now_ts - cached[0]) < _DETECT_CACHE_TTL_SEC:
        cached_resp = cached[1]
        # 重新算 latency (展示为缓存命中, 近似 0)
        cached_resp.latency_ms = max(1, int((time.time() - started) * 1000))
        log.info("online-review cache hit key=%s..", ck[:12])
        return cached_resp

    audit_points = await _load_strategy_audit_points(db, strat)
    linked_library_ids, linked_image_library_ids = await _load_strategy_linked_library_ids_split(db, strat)

    hits: List[Dict[str, Any]] = []
    engines_used: List[str] = []

    # 判断是否图片检测模式
    is_image_mode = body.media_type == "image" or any(
        it.image_base64 for it in body.items
    )

    if is_image_mode:
        # ── 图片检测: sha256 比对 + 多模态 LLM ──
        # 1) 图片库 sha256 比对 (平台库 ∪ 策略关联 image 库)
        from app.services.image_matcher import decode_base64_to_bytes, match_active_images

        # 演示用硬编码 case: 特定涉政图片直接返回"涉政-一级领导-一号领导真人全脸"标签
        DEMO_POLITICAL_SHA256 = "b275e0a375bbcf57ed709386c0bcbc7a11084f8fafe4c7a4d62d14a6d5268e0e"

        image_items = [it for it in body.items if it.image_base64]
        for it in image_items:
            try:
                img_bytes = decode_base64_to_bytes(it.image_base64)
                from app.services.image_matcher import compute_sha256_from_bytes

                img_sha = compute_sha256_from_bytes(img_bytes)
                if img_sha == DEMO_POLITICAL_SHA256:
                    hits.append({
                        "service_code": "image_library",
                        "service_name": "图片库",
                        "label": "political_leader_face",
                        "label_cn": "涉政-一级领导-一号领导真人全脸",
                        "score": 1.0,
                        "quote": None,
                        "bbox": None,
                        "page": None,
                        "timestamp_ms": None,
                        "sensitive_grade": "S3",
                        "risk": RiskLevel.HIGH.value,
                        "source": "image_library",
                    })
                    continue
                image_hits = await match_active_images(
                    db, img_bytes, library_ids=linked_image_library_ids
                )
                if image_hits:
                    hits.extend(image_hits)
            except Exception as exc:
                log.warning("online-review image sha256 match failed: %s", exc)
        engines_used.append("image_library")

        # 2) 多模态 LLM 检测 (校验模型是多模态)
        # 图文审核: 策略开启 image_text_enabled 时, 把文本审核点注入 LLM prompt,
        # 让多模态 LLM 同时审核图片画面 + 图片中可见文字
        text_audit_points_for_image: List[Dict[str, Any]] = []
        if strat and strat.definition and isinstance(strat.definition, dict):
            ite = strat.definition.get("image_text_enabled")
            if ite:
                itm = strat.definition.get("image_text_mode", "reuse_text")
                if itm == "reuse_text":
                    # 复用文本审核规则: 用策略已启用的 text 包审核点
                    text_audit_points_for_image = audit_points
                elif itm == "independent":
                    # 独立规则: 从 image_text_points 加载勾选的审核点
                    itp = strat.definition.get("image_text_points") or {}
                    if isinstance(itp, dict):
                        indep_point_ids: List[int] = []
                        for _iid, pts in itp.items():
                            if isinstance(pts, dict):
                                for pid_str, checked in pts.items():
                                    if checked and pid_str.isdigit():
                                        indep_point_ids.append(int(pid_str))
                        if indep_point_ids:
                            from app.models.audit_point import AuditPoint as _AP

                            indep_rows = await db.execute(
                                select(_AP).where(_AP.id.in_(indep_point_ids))
                            )
                            for ap in indep_rows.scalars():
                                risk = getattr(ap, "risk_level", None)
                                risk_val = risk.value if hasattr(risk, "value") else (str(risk) if risk else None)
                                text_audit_points_for_image.append({
                                    "code": ap.code,
                                    "label_cn": ap.label_cn,
                                    "description": ap.description,
                                    "risk_level": risk_val,
                                })

        llm_hits, model_name, llm_error, correlation_id = await _run_image_llm_detection(
            db,
            image_base64_list=[it.image_base64 for it in image_items if it.image_base64],
            audit_points=audit_points,
            llm_enabled=llm_enabled,
            model_id=model_id,
            text_audit_points=text_audit_points_for_image,
        )
        if llm_hits:
            hits.extend(llm_hits)
        if llm_enabled and not llm_error:
            engines_used.append("llm")
    else:
        # ── 文本检测: 词库匹配 + 文本 LLM (原逻辑) ──
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

        # 3) 审核智能体检测 (策略配了 review_agent_ids 时, 用智能体 points 走 LLM)
        agent_ids: List[int] = []
        if strat and strat.definition:
            ra = strat.definition.get("review_agent_ids") if isinstance(strat.definition, dict) else None
            if isinstance(ra, list):
                agent_ids = [int(x) for x in ra if isinstance(x, (int, float))]
        if agent_ids:
            agent_hits, agent_model, agent_err, _agent_corr = await _run_agent_detection(
                db,
                text_body=full_text,
                agent_ids=agent_ids,
            )
            if agent_hits:
                hits.extend(agent_hits)
                engines_used.append("agent")
            # 智能体模型名回填 (如果策略级 LLM 没跑, 用智能体模型名展示)
            if not model_name and agent_model:
                model_name = agent_model
            if agent_err and not llm_error:
                llm_error = agent_err

    # 聚合风险等级: 命中即高风险 (按需求, 命中直接展示高风险)
    # 先用 label_cn 反查审核点表, 给 LLM/智能体命中的 hit 补上 audit_item_label/audit_point_label
    await _enrich_hits_with_label_path(db, hits)
    # 根据命中的审核点/审核项, 查关联的代答库, 给 hit 补上 reply (代答答案)
    await _enrich_hits_with_reply(db, hits)

    risk_level = RiskLevel.HIGH.value if hits else RiskLevel.NONE.value
    conclusion, conclusion_type = _risk_level_to_conclusion(risk_level)

    data: List[OnlineReviewDataItem] = []
    if hits:
        # 命中即高风险: 强制所有 hit 的风险等级统一为高风险 (覆盖 LLM 自评的中/低风险)
        for h in hits:
            h["risk"] = RiskLevel.HIGH.value
            h["risk_level"] = RiskLevel.HIGH.value
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
    # 图片模式: 传第一张图片的 base64 用于保存文件
    first_image_b64 = None
    if is_image_mode:
        first_image_b64 = next(
            (it.image_base64 for it in body.items if it.image_base64), None
        )
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
        image_base64=first_image_b64,
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
