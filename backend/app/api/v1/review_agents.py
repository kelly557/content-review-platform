"""Review Agents router — 审核智能体 CRUD + 版本 + 测试 + AI 优化 + 文档解析."""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

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


def _to_out(a: ReviewAgent) -> ReviewAgentOut:
    return ReviewAgentOut.model_validate(a)


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
    """在线测试智能体: 复用 LLM 检测管线 (若配置), 否则返回 pass.

    MVP: 把 points 作为审核维度, 走 MAAS 通用审核; 无 MAAS 时降级为 pass.
    """
    started = time.time()
    a = await db.get(ReviewAgent, agent_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="智能体不存在")

    triggered: List[AgentTestTriggeredPoint] = []
    decision = "pass"
    raw: Dict[str, Any] = {"decision": decision, "segments": [], "triggered_points": []}

    text = body.text or ""
    segments = [s for s in text.splitlines() if s.strip()] if body.mode == "multi" else [text]
    raw["segments"] = segments

    if settings.maas_api_key and text.strip():
        try:
            from app.tasks.machine_review import call_llm_detection

            hits, _meta = await call_llm_detection(
                db, task_id=0, version_id=0,
                enabled_services=["text_detection_pro"], text_body=text,
            )
            if hits:
                decision = "block"
                hit_labels = {h.get("label") or h.get("label_cn") for h in hits}
                for p in body.points:
                    is_on = (p.label in hit_labels) or any(p.label in (h.get("label_cn") or "") for h in hits)
                    triggered.append(AgentTestTriggeredPoint(
                        pointId=p.id or p.label, label=p.label, triggered=is_on,
                    ))
                raw["triggered_points"] = [t.label for t in triggered if t.triggered]
            else:
                for p in body.points:
                    triggered.append(AgentTestTriggeredPoint(
                        pointId=p.id or p.label, label=p.label, triggered=False,
                    ))
        except Exception as exc:
            raw["error"] = str(exc)
            for p in body.points:
                triggered.append(AgentTestTriggeredPoint(
                    pointId=p.id or p.label, label=p.label, triggered=False,
                ))
    else:
        for p in body.points:
            triggered.append(AgentTestTriggeredPoint(
                pointId=p.id or p.label, label=p.label, triggered=False,
            ))

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
    """AI 优化提示词: 调 MaaS 对方向描述生成结构化优化建议.

    无 MAAS 时返回降级结构 (不抛错).
    """
    direction = body.direction.strip()
    original = body.original_label or ""

    if settings.maas_api_key:
        try:
            import httpx

            prompt = (
                f"你是审核规则优化专家。请基于以下业务方向，生成一条审核规则的优化建议：\n"
                f"方向：{direction}\n原始标签：{original}\n"
                f"输出 JSON: {{issues:[{{label,text}}], checklist:[str], scenarioNote:str, "
                f"cases:{{note,examples:[{{kind,text}}]}}, finalTag:{{name,description}}}}"
            )
            url = f"{settings.maas_base_url.rstrip('/')}/v1/chat/completions"
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {settings.maas_api_key}",
                    },
                    json={
                        "model": settings.maas_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 800,
                        "temperature": 0.3,
                    },
                )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"] or ""
                import re

                m = re.search(r"\{.*\}", content, re.DOTALL)
                if m:
                    data = json.loads(m.group(0))
                    return AiOptimizeResult(
                        original=original,
                        issues=data.get("issues", []),
                        checklist=data.get("checklist", []),
                        scenarioNote=data.get("scenarioNote", ""),
                        cases=data.get("cases", {}),
                        direction=direction,
                        finalTag=data.get("finalTag", {}),
                    )
        except Exception:
            pass

    # 降级: 返回基础结构
    return AiOptimizeResult(
        original=original,
        issues=[],
        checklist=[],
        scenarioNote=f"基于方向「{direction}」的优化建议（未启用 AI，返回空结构）",
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
    """解析上传的 .txt/.xls/.xlsx 文档，LLM 提取审核点。

    前端将解析结果作为智能体的审核点候选项。LLM 失败时返回空列表 +
    source_info 提示，前端可降级为手动输入。
    """
    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="文件为空")

    try:
        text = extract_text_from_file(content, file.filename or "doc.txt")
    except Exception as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"文件解析失败: {e}")

    if not text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="文件内容为空")

    preview = "\n".join(text.splitlines()[:50])[:10000]

    if not settings.maas_api_key:
        return AgentParseDocResult(
            points=[], source_info="未配置 LLM，请手动输入", preview=preview, char_count=len(text)
        )

    try:
        from app.services.llm.client import get_llm_client

        llm = get_llm_client()
        prompt = (
            "请从以下文档内容中提取审核点。每个审核点包含：\n"
            "- label: 审核点名称（简短描述要审核的内容）\n"
            "- desc: 审核内容描述（具体的审核标准或判断依据）\n\n"
            "请以 JSON 数组格式返回，每个元素包含 label 和 desc 字段。"
            "如果无法提取到有效的审核点，返回空数组 []。\n\n"
            f"文档内容：\n{text[:10000]}"
        )
        response = await llm.chat(
            messages=[{"role": "user", "content": prompt}], temperature=0.1
        )

        import re

        json_match = re.search(r"\[[\s\S]*\]", response)
        raw = json.loads(json_match.group()) if json_match else json.loads(response)
        points = [
            ParsedAgentPoint(label=str(item.get("label", "")), desc=str(item.get("desc", "")))
            for item in raw
            if isinstance(item, dict) and item.get("label")
        ]
        return AgentParseDocResult(
            points=points,
            source_info=f"从 {file.filename} 解析",
            preview=preview,
            char_count=len(text),
        )
    except Exception as e:
        return AgentParseDocResult(
            points=[],
            source_info=f"AI 解析失败，请手动输入。错误: {e}",
            preview=preview,
            char_count=len(text),
        )
