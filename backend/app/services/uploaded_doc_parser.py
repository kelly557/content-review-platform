"""解析用户上传的文件到 AuditPoint 列表。

按文件 kind 分发：

- ``llm``（.pdf/.docx/.txt/.md）：调用 MaaS 大模型，使用 Markdown Prompt 提取审核点。
- ``structured``（.xlsx/.csv）：直接按列映射导入，无 LLM 调用。

注意：此模块是纯函数/类，不直接操作数据库；调用方在 worker 中加载/写入。
"""
from __future__ import annotations

import io
import json
import logging
import re
from pathlib import Path
from typing import Optional, Protocol

import httpx

from app.core.config import settings
from app.schemas.uploaded_document import DEFAULT_LLM_PROMPT
from app.services.document_parser import extract_text_from_file

logger = logging.getLogger(__name__)


STRUCTURED_EXTS = {".xlsx", ".xls", ".csv"}
LLM_EXTS = {".pdf", ".doc", ".docx", ".txt", ".md"}


def classify_file_kind(filename: str) -> str:
    """根据扩展名返回 ``structured`` 或 ``llm``。"""
    ext = Path(filename).suffix.lower()
    if ext in STRUCTURED_EXTS:
        return "structured"
    if ext in LLM_EXTS:
        return "llm"
    raise ValueError(f"不支持的文件类型: {ext}")


class ParsedAuditPointCandidate:
    """LLM 解析或结构化导入的「候选审核点」(尚未落库)。"""

    __slots__ = ("label_cn", "scope_text", "source_quote", "source_line_no")

    def __init__(
        self,
        label_cn: str,
        scope_text: Optional[str] = None,
        source_quote: Optional[str] = None,
        source_line_no: Optional[int] = None,
    ) -> None:
        self.label_cn = label_cn.strip()
        self.scope_text = (scope_text or "").strip() or None
        self.source_quote = source_quote
        self.source_line_no = source_line_no

    def is_valid(self) -> bool:
        return bool(self.label_cn) and len(self.label_cn) <= 64


# ─────────────── Structured file parsing ───────────────

try:
    import openpyxl  # type: ignore
except ImportError:  # pragma: no cover
    openpyxl = None  # type: ignore

try:
    import csv as _csv
except ImportError:  # pragma: no cover
    _csv = None  # type: ignore


def parse_structured_csv(content: bytes) -> list[ParsedAuditPointCandidate]:
    """CSV 文件：固定两列「审核点 | 审核内容」。

    首行作为表头，必须包含「审核点」和「审核内容」列（大小写不敏感）。
    """
    if _csv is None:
        raise RuntimeError("csv module unavailable")
    text = content.decode("utf-8-sig", errors="replace")
    reader = _csv.reader(io.StringIO(text))
    rows = list(reader)
    if len(rows) < 2:
        return []
    headers = [c.strip().lower() for c in rows[0]]
    try:
        idx_label = headers.index("审核点")
    except ValueError:
        try:
            idx_label = headers.index("label_cn")
        except ValueError:
            raise ValueError("CSV 首行缺少「审核点」列")
    try:
        idx_scope = headers.index("审核内容")
    except ValueError:
        try:
            idx_scope = headers.index("scope_text")
        except ValueError:
            idx_scope = -1  # 审核内容可选

    out: list[ParsedAuditPointCandidate] = []
    for line_no, row in enumerate(rows[1:], start=2):
        if not row or all(not (c or "").strip() for c in row):
            continue
        label = (row[idx_label] if idx_label < len(row) else "").strip()
        scope = (row[idx_scope] if 0 <= idx_scope < len(row) else "").strip()
        cand = ParsedAuditPointCandidate(
            label_cn=label,
            scope_text=scope or None,
            source_line_no=line_no,
        )
        if cand.is_valid():
            out.append(cand)
    return out


def parse_structured_xlsx(content: bytes) -> list[ParsedAuditPointCandidate]:
    """XLSX 文件：固定两列「审核点 | 审核内容」。"""
    if openpyxl is None:
        raise RuntimeError("openpyxl 未安装，无法解析 xlsx")
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    ws = wb.active
    if ws is None:
        return []
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        return []
    headers = [str(c or "").strip().lower() for c in header_row]

    try:
        idx_label = headers.index("审核点")
    except ValueError:
        try:
            idx_label = headers.index("label_cn")
        except ValueError:
            raise ValueError("xlsx 首行缺少「审核点」列")
    try:
        idx_scope = headers.index("审核内容")
    except ValueError:
        try:
            idx_scope = headers.index("scope_text")
        except ValueError:
            idx_scope = -1

    out: list[ParsedAuditPointCandidate] = []
    for line_no, row in enumerate(rows_iter, start=2):
        cells = list(row)
        if not cells or all((c is None or str(c).strip() == "") for c in cells):
            continue
        label = str(cells[idx_label] if idx_label < len(cells) else "" or "").strip()
        scope = str(cells[idx_scope] if 0 <= idx_scope < len(cells) else "" or "").strip()
        cand = ParsedAuditPointCandidate(
            label_cn=label,
            scope_text=scope or None,
            source_line_no=line_no,
        )
        if cand.is_valid():
            out.append(cand)
    return out


def parse_structured(content: bytes, filename: str) -> list[ParsedAuditPointCandidate]:
    """统一入口。"""
    ext = Path(filename).suffix.lower()
    if ext in (".xlsx", ".xls"):
        return parse_structured_xlsx(content)
    if ext == ".csv":
        return parse_structured_csv(content)
    raise ValueError(f"不支持的结构化文件类型: {ext}")


# ─────────────── LLM parsing ───────────────


class LLMChatFn(Protocol):
    async def __call__(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ) -> str: ...


async def _default_maas_chat(
    *,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
) -> str:
    """调用 MaaS /v1/chat/completions 端点（非 moderation 任务）。

    与 ``app.services.llm.client.MaaSClient.moderate`` 不同，这里是通用对话调用，
    用于「从文档提取审核点」类任务。鉴权与超时复用 settings。
    """
    if not settings.maas_api_key:
        raise RuntimeError("MAAS_API_KEY 未配置，无法调用 LLM")
    base = settings.maas_base_url.rstrip("/")
    url = f"{base}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.maas_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.maas_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    timeout = float(settings.maas_timeout)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(
            f"MaaS 调用失败 HTTP {resp.status_code}: {resp.text[:300]}"
        )
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"MaaS 返回结构异常: {data}") from exc


def _default_user_message(prompt_markdown: str, text: str) -> tuple[str, str]:
    """组装 system + user 消息。

    System = 用户提供的 Prompt (Markdown)。如果为空，使用默认 Prompt。
    User = 「请按 system 要求从以下文档中提取审核点」+ 截断后的文档文本。
    """
    sys_msg = (prompt_markdown or "").strip() or DEFAULT_LLM_PROMPT
    truncated_text = text[: settings.maas_max_text_chars]
    user_msg = (
        "请按 system 提示中的要求，从以下文档内容中提取审核点。"
        "直接返回 JSON 数组，不要附加任何说明文字。\n\n"
        f"文档内容：\n{truncated_text}"
    )
    return sys_msg, user_msg


def _extract_json_array(text: str) -> list[dict]:
    """从 LLM 返回中尽力抽取 JSON 数组。"""
    text = text.strip()
    # 优先：整体就是 JSON
    if text.startswith("["):
        return json.loads(text)
    # 兜底：找 ```json ... ``` 块
    fence = re.search(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", text)
    if fence:
        return json.loads(fence.group(1))
    # 兜底：找首个 [ ... ] 顶层数组
    arr = re.search(r"\[[\s\S]*\]", text)
    if arr:
        return json.loads(arr.group())
    # 兜底：JSON 对象形式 {"points": [...]} / {"items": [...]}
    obj = re.search(r"\{[\s\S]*\}", text)
    if obj:
        try:
            payload = json.loads(obj.group())
        except json.JSONDecodeError:
            return []
        if isinstance(payload, dict):
            for key in ("points", "items", "audit_points", "data"):
                v = payload.get(key)
                if isinstance(v, list):
                    return v
    return []


async def parse_llm(
    content: bytes,
    filename: str,
    *,
    prompt_markdown: Optional[str] = None,
    chat: Optional[LLMChatFn] = None,
) -> list[ParsedAuditPointCandidate]:
    """调用 LLM 解析文档，返回候选审核点列表。

    ``chat`` 可注入；默认使用 ``_default_maas_chat``。
    """
    text = extract_text_from_file(content, filename)
    if not text.strip():
        raise RuntimeError("文件内容为空")

    system_msg, user_msg = _default_user_message(prompt_markdown or "", text)
    chat_fn = chat or _default_maas_chat
    raw = await chat_fn(
        system=system_msg,
        user=user_msg,
        temperature=0.1,
        max_tokens=4096,
    )
    raw_points = _extract_json_array(raw)
    out: list[ParsedAuditPointCandidate] = []
    for item in raw_points:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label_cn", "")).strip()
        scope = str(item.get("scope_text", "")).strip() or None
        quote = item.get("source_quote") or item.get("quote")
        if quote is not None:
            quote = str(quote).strip() or None
        cand = ParsedAuditPointCandidate(
            label_cn=label,
            scope_text=scope,
            source_quote=quote,
        )
        if cand.is_valid():
            out.append(cand)
    return out


# ─────────────── Top-level dispatch ───────────────


async def parse_uploaded_file(
    *,
    kind: str,
    content: bytes,
    filename: str,
    prompt_markdown: Optional[str] = None,
    chat: Optional[LLMChatFn] = None,
) -> list[ParsedAuditPointCandidate]:
    """按 kind 路由到对应的解析器。"""
    if kind == "structured":
        return parse_structured(content, filename)
    if kind == "llm":
        return await parse_llm(
            content, filename, prompt_markdown=prompt_markdown, chat=chat
        )
    raise ValueError(f"unknown kind: {kind}")