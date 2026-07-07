"""Desensitization engine.

Pure-Python masker that takes a piece of text (usually a hit ``quote`` or
``text_body``) and returns:

- ``masked``: the text with every matched span replaced
- ``spans``:  the list of ``[start, end, category, original]`` tuples for
              audit / preview UI

Built-in rules cover PII (id_card / phone / bank_card / email / address)
plus a tenant-supplied custom-word allowlist (whitelist). Whitelist hits
are never masked (avoid false positives on order numbers, tracking
numbers, employee IDs that share digit patterns with mobile phones).

Usage::

    from app.services.desensitization import build_default_rules, desensitize

    rules = build_default_rules() + custom_wordset_rules  # tenant words
    result = desensitize("致电 13812345678 退订", rules)

    # result.masked  -> "致电 138****5678 退订"
    # result.spans   -> [(2, 13, "phone", "13812345678")]
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Sequence


@dataclass(frozen=True)
class MaskRule:
    category: str
    pattern: str          # regex source
    mask_template: str    # e.g. "{prefix3}****{suffix4}"
    enabled: bool = True

    def compiled(self) -> re.Pattern[str]:
        return re.compile(self.pattern)


# Built-in PII rules. Mask templates use Python str.format placeholders.
_DEFAULT_RULES: List[MaskRule] = [
    MaskRule(
        category="id_card",
        pattern=r"\b\d{17}[\dXx]\b",
        mask_template="{keep_prefix}{asterisk}{keep_suffix}",
    ),
    MaskRule(
        category="phone",
        pattern=r"(?<![\d])1[3-9]\d{9}(?![\d])",
        mask_template="{keep_prefix}{asterisk}{keep_suffix}",
    ),
    MaskRule(
        category="bank_card",
        pattern=r"\b\d{16,19}\b",
        mask_template="{keep_prefix}{asterisk}{keep_suffix}",
    ),
    MaskRule(
        category="email",
        pattern=r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b",
        mask_template="{keep_prefix}{asterisk}@{keep_suffix}",
    ),
    MaskRule(
        category="address",
        # 省/市/区/县/路/街/号 — only flags when chained (>= 2 segments).
        pattern=r"[\u4e00-\u9fa5]{2,8}(?:省|市|自治区|特别行政区)"
                r"(?:[\u4e00-\u9fa5]{2,20}(?:市|区|县))?"
                r"(?:[\u4e00-\u9fa5\d]{2,30}(?:路|街|道|巷|弄))?"
                r"(?:\d{1,5}号)?",
        mask_template="****",
    ),
]


@dataclass(frozen=True)
class MaskSpan:
    start: int
    end: int
    category: str
    original: str


@dataclass(frozen=True)
class MaskResult:
    masked: str
    spans: List[MaskSpan]
    category: str | None = None  # dominant category for the whole text


def _mask(template: str, original: str, category: str | None = None) -> str:
    """Render a mask template against the matched text.

    Supported placeholders:
    - ``{keep_prefix}``   first 3 chars (or whole text if shorter)
    - ``{keep_suffix}``   last  4 chars (or empty)
    - ``{asterisk}``      fixed ``****``
    - ``{keep_prefix_k}`` ``{keep_prefix}<k>`` — first k chars
    - ``{keep_suffix_k}`` ``{keep_suffix}<k>`` — last  k chars

    Category-aware tweaks:
    - email: split local-part / domain at ``@``; suffix token returns the
      full domain so users can still tell what service the address belongs
      to (e.g. ``zha****@example.com``).
    """
    n = len(original)
    prefix_len = min(3, n)
    suffix_len = min(4, max(0, n - prefix_len))

    if category == "email" and "@" in original:
        local, _, domain = original.partition("@")
        local_prefix = local[: min(2, len(local))]
        keep_suffix_value = domain
    else:
        keep_suffix_value = original[n - suffix_len:] if suffix_len else ""

    placeholders = {
        "keep_prefix": original[:prefix_len],
        "keep_suffix": keep_suffix_value,
        "asterisk": "****",
    }

    def _sub(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in placeholders:
            return placeholders[key]
        m = re.match(r"keep_prefix_(\d+)", key)
        if m:
            k = int(m.group(1))
            return original[: min(k, n)]
        m = re.match(r"keep_suffix_(\d+)", key)
        if m:
            k = int(m.group(1))
            return original[max(0, n - k):]
        return match.group(0)

    return re.sub(r"\{(keep_prefix(?::\d+)?|keep_suffix(?::\d+)?|asterisk)\}", _sub, template)


def desensitize(
    text: str,
    rules: Sequence[MaskRule] | None = None,
    *,
    whitelist: Iterable[str] | None = None,
) -> MaskResult:
    """Apply enabled rules to ``text``.

    Whitelist substrings short-circuit masking: if a candidate span appears
    in the whitelist it is preserved verbatim. (Used to skip masking of
    order/tracking numbers that overlap the phone regex.)
    """
    if not text:
        return MaskResult(masked=text, spans=[])

    effective = [r for r in (rules or _DEFAULT_RULES) if r.enabled]
    if not effective:
        return MaskResult(masked=text, spans=[])

    whitelist_set = {w for w in (whitelist or []) if w}
    if whitelist_set:
        whitelist_pattern = re.compile(
            "|".join(re.escape(w) for w in whitelist_set)
        )

    spans: List[MaskSpan] = []
    pieces: List[str] = []
    cursor = 0

    # Iterate through all matches across all rules; sort by position.
    all_matches: List[tuple[int, int, MaskRule, re.Match[str]]] = []
    for rule in effective:
        try:
            for m in rule.compiled().finditer(text):
                all_matches.append((m.start(), m.end(), rule, m))
        except re.error:
            # Skip malformed rule rather than crashing the whole pipeline.
            continue

    all_matches.sort(key=lambda x: (x[0], -(x[1] - x[0])))

    for start, end, rule, match in all_matches:
        if start < cursor:
            continue  # overlap with already-applied earlier match
        original = match.group(0)
        if whitelist_set and whitelist_pattern.search(original):
            continue
        spans.append(MaskSpan(start=start, end=end, category=rule.category, original=original))
        pieces.append(text[cursor:start])
        pieces.append(_mask(rule.mask_template, original, category=rule.category))
        cursor = end

    pieces.append(text[cursor:])
    masked = "".join(pieces)

    # Dominant category = highest-priority category among spans (id_card > phone > email > ...).
    priority = ("id_card", "phone", "bank_card", "email", "address", "custom")
    dominant = next((c for c in priority if any(s.category == c for s in spans)), None)
    return MaskResult(masked=masked, spans=spans, category=dominant)


def build_default_rules() -> List[MaskRule]:
    return list(_DEFAULT_RULES)