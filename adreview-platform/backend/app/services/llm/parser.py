"""Parse + normalize the JSON content returned by the LLM.

The LLM is asked to return strict JSON (``response_format=json_object``) but we
defend against drift: malformed lines, hallucinated fields, ``quote`` strings
that don't appear in the source text, scores outside ``[0, 1]``, etc.

Normalization rules
-------------------
- ``score`` is clamped to ``[0.0, 1.0]``.
- ``sensitive_grade`` is forced into ``{S0, S1, S2, S3}``; anything else is S0.
- ``quote`` whose substring is not present in ``original_text`` is dropped
  (we keep the hit but null out the quote) — defending against false evidence.
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


def parse_moderation_result(content: str, *, original_text: str) -> ModerationResult:
    """Parse the LLM's JSON content and normalize it against ``original_text``."""
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
        try:
            hit = ModerationHit(**raw)
        except Exception:
            log.warning("drop malformed hit", exc_info=True)
            continue
        if hit.quote and not _quote_appears_in(hit.quote, original_text):
            hit = hit.model_copy(update={"quote": None})
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


def _quote_appears_in(quote: str, original_text: Optional[str]) -> bool:
    if not original_text:
        return False
    if not quote:
        return False
    q = quote.strip().strip("“”\"'")
    src = original_text
    return q in src
