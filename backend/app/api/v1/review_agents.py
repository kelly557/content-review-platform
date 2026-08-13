"""Review Agents router — 审核智能体 CRUD + 版本 + 测试 + AI 优化 + 文档解析."""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.review_agent import ReviewAgent, ReviewAgentVersion
from app.models.user import User
from app.services.document_parser import extract_text_from_file
from app.schemas.review_agent import (
    AgentTestRequest,
    AgentTestResult,
    AgentTestTriggeredPoint,
    AgentVersionSnapshot,
    AiOptimizeRequest,
    AiOptimizeResult,
    ReviewAgentCreate,
    ReviewAgentOut,
    ReviewAgentUpdate,
    ReviewAgentVersionOut,
)

router = APIRouter(prefix="/review-agents", tags=["review-agents"])
logger = logging.getLogger(__name__)


def _to_out(a: ReviewAgent) -> ReviewAgentOut:
    return ReviewAgentOut.model_validate(a)


def _reconstruct_slice(text: str, start: Any, length: Any) -> Optional[str]:
    """从 start/length 在原文切出片段 (LLM 只给位置, 后端重建). 越界返回 None."""
    if not text or not isinstance(start, int) or not isinstance(length, int):
        return None
    if start < 0 or length <= 0 or start > len(text):
        return None
    end = min(start + length, len(text))
    snippet = text[start:end].strip().strip("“”\"'")
    return snippet or None


@router.get("", response_model=List[ReviewAgentOut])
async def list_agents(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[ReviewAgentOut]:
    result = await db.execute(select(ReviewAgent).order_by(ReviewAgent.id.desc()))
    return [_to_out(a) for a in result.scalars()]


@router.post("", response_model=ReviewAgentOut, status_code=status.HTTP_201_CREATED)
async def create_agent(
    body: ReviewAgentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "superadmin")),
) -> ReviewAgentOut:
    exists = await db.execute(select(ReviewAgent).where(ReviewAgent.app_id == body.app_id))
    if exists.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"app_id '{body.app_id}' 已存在")
    a = ReviewAgent(
        app_id=body.app_id,
        name=body.name,
        modality=body.modality,
        model_id=body.model_id,
        points=[p.model_dump() for p in body.points],
        status="未发布",
        created_by_id=user.id,
        draft_saved_at=datetime.now(timezone.utc),
    )
    db.add(a)
    await db.flush()
    await db.commit()
    await db.refresh(a)
    return _to_out(a)


@router.get("/{agent_id}", response_model=ReviewAgentOut)
async def get_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ReviewAgentOut:
    a = await db.get(ReviewAgent, agent_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="智能体不存在")
    return _to_out(a)


@router.put("/{agent_id}", response_model=ReviewAgentOut)
async def update_agent(
    agent_id: int,
    body: ReviewAgentUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> ReviewAgentOut:
    a = await db.get(ReviewAgent, agent_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="智能体不存在")
    if body.name is not None:
        a.name = body.name
    if body.modality is not None:
        a.modality = body.modality
    if body.model_id is not None:
        a.model_id = body.model_id
    if body.points is not None:
        a.points = [p.model_dump() for p in body.points]
    a.draft_saved_at = datetime.now(timezone.utc)
    await db.flush()
    await db.commit()
    await db.refresh(a)
    return _to_out(a)


@router.delete("/{agent_id}", status_code=status.HTTP_200_OK)
async def delete_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> dict:
    a = await db.get(ReviewAgent, agent_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="智能体不存在")
    await db.delete(a)
    await db.commit()
    return {"ok": True, "id": agent_id}


@router.get("/{agent_id}/versions", response_model=List[ReviewAgentVersionOut])
async def list_versions(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[ReviewAgentVersionOut]:
    result = await db.execute(
        select(ReviewAgentVersion)
        .where(ReviewAgentVersion.agent_id == agent_id)
        .order_by(ReviewAgentVersion.id.desc())
    )
    return [ReviewAgentVersionOut.model_validate(v) for v in result.scalars()]


@router.post("/{agent_id}/publish", response_model=ReviewAgentVersionOut)
async def publish_version(
    agent_id: int,
    snapshot: AgentVersionSnapshot,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> ReviewAgentVersionOut:
    a = await db.get(ReviewAgent, agent_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="智能体不存在")
    # 翻转旧 is_current
    result = await db.execute(
        select(ReviewAgentVersion).where(ReviewAgentVersion.agent_id == agent_id)
    )
    existing = list(result.scalars())
    for v in existing:
        v.is_current = False
    next_seq = len(existing) + 1
    ver = ReviewAgentVersion(
        agent_id=agent_id,
        version=f"v{next_seq}",
        status="published",
        is_current=True,
        snapshot=snapshot.model_dump(),
    )
    db.add(ver)
    a.status = "已发布"
    a.current_version = f"v{next_seq}"
    a.online_at = datetime.now(timezone.utc)
    a.published_at = datetime.now(timezone.utc)
    await db.flush()
    await db.commit()
    await db.refresh(ver)
    return ReviewAgentVersionOut.model_validate(ver)


@router.post("/{agent_id}/unpublish", response_model=ReviewAgentVersionOut)
async def unpublish_current(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> ReviewAgentVersionOut:
    a = await db.get(ReviewAgent, agent_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="智能体不存在")
    result = await db.execute(
        select(ReviewAgentVersion).where(ReviewAgentVersion.agent_id == agent_id)
    )
    current = None
    for v in result.scalars():
        if v.is_current:
            v.is_current = False
            current = v
    a.status = "已下线"
    a.current_version = None
    await db.flush()
    await db.commit()
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="无当前版本")
    await db.refresh(current)
    return ReviewAgentVersionOut.model_validate(current)


@router.post("/{agent_id}/test", response_model=AgentTestResult)
async def test_agent(
    agent_id: int,
    body: AgentTestRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AgentTestResult:
    """在线测试智能体: 用智能体配置的 model_id + points 走真实大模型判定.

    只用智能体自己的审核维度 (points), 不叠加 moderation 管线. 模型优先级:
    body.model_id > agent.model_id > 注册库默认文本大模型.
    """
    from app.services.llm.resolver import resolve_llm_client

    started = time.time()
    a = await db.get(ReviewAgent, agent_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="智能体不存在")

    # 模态: body.modality 优先, 回退 agent.modality
    modality = body.modality or a.modality or "文本"
    is_image = modality in ("图片", "图文")

    triggered: List[AgentTestTriggeredPoint] = []
    decision = "pass"
    raw: Dict[str, Any] = {"decision": decision, "segments": [], "triggered_points": [], "modality": modality}

    text = body.text or ""
    image_base64 = body.image_base64 or ""
    segments = [s for s in text.splitlines() if s.strip()] if body.mode == "multi" else [text]
    raw["segments"] = segments

    # 模型解析: agent.model_id > 注册库默认 (AgentTestRequest 无 model_id 字段)
    model_id = a.model_id

    # 空输入短路: 文本模态校验 text, 图片模态校验 image_base64
    if is_image and not image_base64.strip():
        for p in body.points:
            triggered.append(AgentTestTriggeredPoint(
                pointId=p.id or p.label, label=p.label, triggered=False,
            ))
        return AgentTestResult(
            decision=decision,
            latencyMs=int((time.time() - started) * 1000),
            confidence=0.0,
            triggered=triggered,
            rawOutput=json.dumps(raw, ensure_ascii=False, indent=2),
        )
    if not is_image and not text.strip():
        for p in body.points:
            triggered.append(AgentTestTriggeredPoint(
                pointId=p.id or p.label, label=p.label, triggered=False,
            ))
        return AgentTestResult(
            decision=decision,
            latencyMs=int((time.time() - started) * 1000),
            confidence=0.0,
            triggered=triggered,
            rawOutput=json.dumps(raw, ensure_ascii=False, indent=2),
        )

    client, model_name, resolve_err = await resolve_llm_client(db, model_id)
    if not client:
        raw["error"] = resolve_err or "大模型客户端未就绪"
        for p in body.points:
            triggered.append(AgentTestTriggeredPoint(
                pointId=p.id or p.label, label=p.label, triggered=False,
            ))
        return AgentTestResult(
            decision=decision,
            latencyMs=int((time.time() - started) * 1000),
            confidence=0.0,
            triggered=triggered,
            rawOutput=json.dumps(raw, ensure_ascii=False, indent=2),
        )

    # 用智能体 points 作为审核维度构造 prompt (位置输出, 后端重建 quote, 避免网关输出审查)
    points_block = "\n".join(
        f"- label: {p.label}" + (f" | 审核标准: {p.desc}" if p.desc else "")
        for p in body.points
    ) or "(无审核维度)"

    if is_image:
        # 图片模态: 多模态 messages, 无 start/length 文本定位, 用描述式 evidence
        system_msg = (
            "你是审核智能体执行引擎。基于用户配置的审核维度, 判断输入图片是否违规。"
            "输出必须是严格 JSON, 严禁在输出中复述违规原文。"
        )
        user_text = (
            f"审核维度:\n{points_block}\n\n"
            "请输出 JSON: {\"hit_points\":[{\"label\":\"对应维度label\","
            "\"risk\":\"高风险|中风险|低风险\",\"evidence\":\"画面中的违规元素描述\"}],"
            "\"summary\":\"类别化摘要, 不得含违规原文\"}\n"
            "未命中则 hit_points=[]。直接以 { 开头。"
        )
        # base64 清洗: 支持 "data:image/jpeg;base64,..." 前缀或纯 base64
        b64 = image_base64.strip()
        if not b64.startswith("data:"):
            b64 = f"data:image/jpeg;base64,{b64}"
        user_content = [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": b64}},
        ]
        if text.strip():
            user_content.insert(1, {"type": "text", "text": f"补充文本说明:\n\"\"\"{text[:settings.maas_max_text_chars]}\"\"\""})
        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_content},
        ]
    else:
        # 文本模态: 纯文本 messages, start/length 定位
        system_msg = (
            "你是审核智能体执行引擎。基于用户配置的审核维度, 判断输入文本是否违规。"
            "输出必须是严格 JSON, 严禁在输出中复述违规原文, 违规片段只用 start/length 定位。"
        )
        user_msg = (
            f"审核维度:\n{points_block}\n\n"
            f"待审核文本:\n\"\"\"{text[:settings.maas_max_text_chars]}\"\"\"\n\n"
            "请输出 JSON: {\"hit_points\":[{\"label\":\"对应维度label\","
            "\"start\":0,\"length\":0,\"risk\":\"高风险|中风险|低风险\"}],"
            "\"summary\":\"类别化摘要, 不得含违规原文\"}\n"
            "未命中则 hit_points=[]。直接以 { 开头。"
        )
        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ]

    correlation_id = uuid.uuid4().hex
    try:
        content = await client.chat(
            db=db,
            messages=messages,
            temperature=0.1,
            max_tokens=2048,
            correlation_id=correlation_id,
            response_format={"type": "json_object"},
        )
        import re

        m = re.search(r"\{.*\}", content, re.DOTALL)
        payload = json.loads(m.group(0)) if m else {}
        hit_points = payload.get("hit_points") or []
        # 重建 quote + 收集命中 label
        hit_labels: set[str] = set()
        reconstructed: List[Dict[str, Any]] = []
        for hp in hit_points:
            if not isinstance(hp, dict):
                continue
            label = (hp.get("label") or "").strip()
            start = hp.get("start")
            length = hp.get("length")
            if is_image:
                # 图片模态: 用 evidence 描述代替 quote
                evidence = hp.get("evidence")
                quote = evidence if isinstance(evidence, str) else None
            else:
                quote = _reconstruct_slice(text, start, length)
            if label:
                hit_labels.add(label)
            reconstructed.append({"label": label, "quote": quote, "risk": hp.get("risk")})
        raw["hit_points"] = reconstructed
        raw["summary"] = payload.get("summary")
        raw["model"] = model_name

        if hit_labels:
            decision = "block"
        for p in body.points:
            is_on = p.label in hit_labels
            triggered.append(AgentTestTriggeredPoint(
                pointId=p.id or p.label, label=p.label, triggered=is_on,
            ))
        raw["triggered_points"] = [t.label for t in triggered if t.triggered]
    except Exception as exc:
        raw["error"] = f"大模型调用失败: {exc}"
        raw["model"] = model_name
        for p in body.points:
            triggered.append(AgentTestTriggeredPoint(
                pointId=p.id or p.label, label=p.label, triggered=False,
            ))

    # 落 llm_calls 审计 (record_llm_call 只 flush, 需 commit)
    try:
        await db.commit()
    except Exception:
        await db.rollback()

    return AgentTestResult(
        decision=decision,
        latencyMs=int((time.time() - started) * 1000),
        confidence=0.85 if decision == "block" else 0.0,
        triggered=triggered,
        rawOutput=json.dumps(raw, ensure_ascii=False, indent=2),
    )


@router.post("/ai-optimize", response_model=AiOptimizeResult)
async def ai_optimize(
    body: AiOptimizeRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AiOptimizeResult:
    """AI 优化提示词: 调注册库大模型对方向描述生成结构化优化建议.

    无可用大模型时返回降级结构 (不抛错).
    """
    from app.services.llm.resolver import resolve_llm_client

    direction = body.direction.strip()
    original = body.original_label or ""

    client, _model_name, resolve_err = await resolve_llm_client(db, model_id=None)
    if not client:
        return AiOptimizeResult(
            original=original,
            issues=[],
            checklist=[],
            scenarioNote=f"基于方向「{direction}」的优化建议（大模型不可用：{resolve_err}）",
            cases={},
            direction=direction,
            finalTag={"name": original or "新规则", "description": direction},
        )

    prompt = (
        "你是审核规则优化专家。请基于以下业务方向，生成一条审核规则的优化建议：\n"
        f"方向：{direction}\n原始标签：{original}\n"
        "直接输出 JSON 对象（不要任何思考过程、解释或 markdown 围栏），schema：\n"
        '{"issues":[{"label":"","text":""}],"checklist":[""],"scenarioNote":"",'
        '"cases":{"note":"","examples":[{"kind":"","text":""}]},"finalTag":{"name":"","description":""}}\n'
        "约束：cases.examples[].kind 只能是英文 'compliant'（合规）或 'violation'（违规），"
        "不得用中文；finalTag.name 精简到 15 字以内。"
    )
    correlation_id = uuid.uuid4().hex
    try:
        content = await client.chat(
            db=db,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=3000,
            correlation_id=correlation_id,
        )
        import re

        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            data = json.loads(m.group(0))
            try:
                await db.commit()
            except Exception:
                await db.rollback()
            return AiOptimizeResult(
                original=original,
                issues=data.get("issues", []),
                checklist=data.get("checklist", []),
                scenarioNote=data.get("scenarioNote", ""),
                cases=data.get("cases", {}),
                direction=direction,
                finalTag=data.get("finalTag", {}),
            )
        else:
            logger.warning("ai_optimize: no JSON object in content: %s", content[:200])
    except Exception as exc:
        logger.warning("ai_optimize: LLM call/parse failed: %s", exc)
    try:
        await db.rollback()
    except Exception:
        pass

    # 降级: 返回基础结构
    return AiOptimizeResult(
        original=original,
        issues=[],
        checklist=[],
        scenarioNote=f"基于方向「{direction}」的优化建议（AI 调用失败，返回空结构）",
        cases={},
        direction=direction,
        finalTag={"name": original or "新规则", "description": direction},
    )


# ──────────────────────────────────────────────────────────────
# 文档解析 — 从上传文档中提取审核点（供智能体配置引用）
# ──────────────────────────────────────────────────────────────


class ParsedAgentPoint(BaseModel):
    label: str
    desc: str = ""


class AgentParseDocResult(BaseModel):
    points: List[ParsedAgentPoint]
    source_info: str
    preview: str = ""
    char_count: int = 0


@router.post("/parse-doc", response_model=AgentParseDocResult)
async def parse_agent_doc(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AgentParseDocResult:
    """解析上传的 .txt/.xls/.xlsx/.pdf/.docx 文档，LLM 提取审核点。

    统一走 ``uploaded_doc_parser.parse_uploaded_file`` (底层 MaaSClient.chat
    + 模型注册库). 前端将解析结果作为智能体的审核点候选项。LLM 失败时返回
    空列表 + source_info 提示，前端可降级为手动输入。
    """
    from app.services.uploaded_doc_parser import (
        classify_file_kind,
        parse_uploaded_file,
    )

    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="文件为空")

    # 预览: 结构化文件 (csv/xlsx) 直接用原文前若干行; llm 文件走 extract_text
    from app.services.uploaded_doc_parser import (
        STRUCTURED_EXTS,
        classify_file_kind,
        parse_uploaded_file,
    )

    fname = file.filename or "doc.txt"
    kind = classify_file_kind(fname)
    preview_text = ""
    text_len = 0
    if kind == "structured":
        # csv/xlsx: 取原文前 50 行做预览
        try:
            raw_preview = content.decode("utf-8-sig", errors="replace")
            preview_text = "\n".join(raw_preview.splitlines()[:50])[:10000]
            text_len = len(raw_preview)
        except Exception:
            pass
    else:
        try:
            text = extract_text_from_file(content, fname)
            preview_text = "\n".join(text.splitlines()[:50])[:10000]
            text_len = len(text)
        except Exception as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"文件解析失败: {e}")
    if not preview_text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="文件内容为空")

    try:
        candidates = await parse_uploaded_file(
            db,
            kind=kind,
            content=content,
            filename=fname,
        )
        points = [
            ParsedAgentPoint(label=c.label_cn, desc=c.scope_text or "")
            for c in candidates
            if c.is_valid()
        ]
        try:
            await db.commit()
        except Exception:
            await db.rollback()
        return AgentParseDocResult(
            points=points,
            source_info=f"从 {fname} 解析（{len(points)} 个审核点）",
            preview=preview_text,
            char_count=text_len,
        )
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        return AgentParseDocResult(
            points=[],
            source_info=f"AI 解析失败，请手动输入。错误: {e}",
            preview=preview_text,
            char_count=text_len,
        )
