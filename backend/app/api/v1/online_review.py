"""Online review (即时检测) router — synchronous detect for inline text.

复用 machine_review 的词库匹配 + LLM 检测管线，但不落 review_tasks /
material，适合「在线审核」页面的即时试检测场景。

响应结构对齐前端 onlineReviewMock 的 MockResponse：
  { conclusion, log_id, conclusionType, data: [{ msg, conclusion, hits: [...] }] }
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.human_review_config import RiskLevel
from app.models.user import User

router = APIRouter(prefix="/online-review", tags=["online-review"])


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


class OnlineReviewResponse(BaseModel):
    conclusion: str
    log_id: int
    conclusionType: int  # 1 = 合规, 2 = 不合规
    data: List[OnlineReviewDataItem]
    latency_ms: int


def _risk_level_to_conclusion(risk_level: str) -> tuple[str, int]:
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

    # 服务列表：默认 text_detection_pro；若 strategy 指定则用 strategy 的 services
    enabled_services = ["text_detection_pro"]
    if body.strategy_id:
        from app.models.strategy import Strategy

        strat = await db.get(Strategy, body.strategy_id)
        if strat and strat.definition:
            svcs = strat.definition.get("services") if isinstance(strat.definition, dict) else None
            if isinstance(svcs, list) and svcs:
                enabled_services = [s.get("code") if isinstance(s, dict) else s for s in svcs if s]

    hits: List[Dict[str, Any]] = []

    # 1) 本地词库匹配
    try:
        from app.services.wordset_matcher import match_active_words

        local_hits = await match_active_words(db, full_text, enabled_services)
        if local_hits:
            hits.extend(local_hits)
    except Exception:
        pass

    # 2) LLM 检测（仅在 MAAS_API_KEY 配置时；否则降级为仅词库）
    if settings.maas_api_key and full_text.strip():
        try:
            from app.tasks.machine_review import call_llm_detection

            llm_hits, _meta = await call_llm_detection(
                db,
                task_id=0,
                version_id=0,
                enabled_services=enabled_services,
                text_body=full_text,
            )
            if llm_hits:
                hits.extend(llm_hits)
        except Exception:
            # LLM 失败不阻塞，仅词库结果
            pass

    # 聚合风险等级
    from app.tasks.machine_review import aggregate_risk_level

    risk_level = aggregate_risk_level(hits) if hits else RiskLevel.NONE.value
    conclusion, conclusion_type = _risk_level_to_conclusion(risk_level)

    data: List[OnlineReviewDataItem] = []
    if hits:
        resp_hits = [_hit_to_response(h) for h in hits]
        msg = f"检测到 {len(hits)} 条命中，风险等级：{risk_level}"
        data.append(OnlineReviewDataItem(msg=msg, conclusion=conclusion, hits=resp_hits))
    else:
        msg = "未检测到风险内容"
        data.append(OnlineReviewDataItem(msg=msg, conclusion="合规", hits=[]))

    latency_ms = int((time.time() - started) * 1000)
    log_id = abs(hash(uuid.uuid4().hex)) % (10**16)

    return OnlineReviewResponse(
        conclusion=conclusion,
        log_id=log_id,
        conclusionType=conclusion_type,
        data=data,
        latency_ms=latency_ms,
    )
