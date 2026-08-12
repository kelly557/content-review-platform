"""Parse + normalize the JSON content returned by the LLM.

The LLM is asked to return strict JSON (``response_format=json_object``) but we
defend against drift: malformed lines, hallucinated fields, ``start``/``length``
that don't map into the source text, scores outside ``[0, 1]``, etc.

Normalization rules
-------------------
- ``score`` is clamped to ``[0.0, 1.0]``.
- ``sensitive_grade`` is forced into ``{S0, S1, S2, S3}``; anything else is S0.
- ``quote`` is **reconstructed locally** from ``start``/``length`` against
  ``original_text`` (the LLM never returns the raw violating text, to avoid
  the gateway's output content-inspection blocking the response). If the
  slice is out of range / empty, ``quote`` is nulled (hit kept).
- Empty results are tolerated: a "无风险" material returns
  ``{risk_level: "无风险", hits: [], rule_hits: [], summary: "..."}``.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from app.core.logging import get_logger

from .schema import ModerationHit, ModerationResult, ModerationRuleHit

log = get_logger(__name__)


class ModerationParseError(ValueError):
    """Raised when the LLM content cannot be coerced to ModerationResult."""


def parse_moderation_result(
    content: str,
    *,
    original_text: str,
    valid_audit_point_codes: Optional[set[str]] = None,
) -> ModerationResult:
    """Parse the LLM's JSON content and normalize it against ``original_text``.

    ``valid_audit_point_codes`` — 若提供, 则校验每条 hit 的 ``audit_point_code``
    是否在该集合内; 不在的 hit 被丢弃 (LLM 编造 code).
    """
    if not content:
        raise ModerationParseError("empty content")

    data = _extract_json_object(content)
    if not isinstance(data, dict):
        raise ModerationParseError("content is not a JSON object")

    raw_hits = data.get("hits") or []
    raw_rule_hits = data.get("rule_hits") or []

    hits: list[ModerationHit] = []
    for raw in raw_hits:
        if not isinstance(raw, dict):
            continue
        # 若模型仍回传了 quote 文本 (旧习惯), 丢弃 — 只信任本地重建.
        if "quote" in raw:
            raw = {k: v for k, v in raw.items() if k != "quote"}
        # 校验 audit_point_code: 若提供了合法集合, 丢弃不在集合内的 hit.
        apc = raw.get("audit_point_code") or ""
        if valid_audit_point_codes is not None and apc and apc not in valid_audit_point_codes:
            log.warning(
                "drop hit with invalid audit_point_code=%s (not in %d codes)",
                apc, len(valid_audit_point_codes),
            )
            continue
        try:
            hit = ModerationHit(**raw)
        except Exception:
            log.warning("drop malformed hit", exc_info=True)
            continue
        quote = _reconstruct_quote(hit.start, hit.length, original_text)
        hit = hit.model_copy(update={"quote": quote})
        hits.append(hit)

    rule_hits: list[ModerationRuleHit] = []
    for raw in raw_rule_hits:
        if not isinstance(raw, dict):
            continue
        try:
            rule_hits.append(ModerationRuleHit(**raw))
        except Exception:
            log.warning("drop malformed rule_hit", exc_info=True)
            continue

    return ModerationResult(
        risk_level=str(data.get("risk_level") or "无风险"),
        sensitive_level=str(data.get("sensitive_level") or "S0"),
        hits=hits,
        rule_hits=rule_hits,
        summary=data.get("summary"),
    )


def _extract_json_object(content: str) -> Any:
    """Tolerate fences / leading prose; return the first JSON object found."""
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError as exc:
                raise ModerationParseError(str(exc)) from exc
        raise ModerationParseError("no JSON object in content")


def _reconstruct_quote(
    start: Optional[int], length: Optional[int], original_text: Optional[str]
) -> Optional[str]:
    """从 start/length 在 original_text 上切出违规原文片段.

    LLM 只返回位置 (不复述原文, 避免网关输出审查拦截); 后端在此重建 quote.
    校验: start/length 为非负整数、切片落在原文范围内、结果非空.
    任一不满足 → 返回 None (hit 保留, 仅 quote 为空).
    """
    if not original_text:
        return None
    if not isinstance(start, int) or not isinstance(length, int):
        return None
    if start < 0 or length <= 0 or start > len(original_text):
        return None
    end = start + length
    if end > len(original_text):
        end = len(original_text)
    snippet = original_text[start:end]
    snippet = snippet.strip().strip("“”\"'")
    return snippet or None
