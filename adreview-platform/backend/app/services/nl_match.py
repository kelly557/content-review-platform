"""Natural-language → audit_item suggester.

Currently a MOCK: returns the first N enabled items in deterministic order
with synthetic scores. The interface (ItemSuggestion shape, SuggestResponse
contract) is stable so the impl can be swapped for jieba/aliases scoring or
a real rule engine later without API or frontend changes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint


@dataclass
class _Scored:
    item: AuditItem
    point_count: int
    score: float
    matched_aliases: list[str]
    matched_terms: list[str]


async def suggest_items(
    db: AsyncSession,
    package_code: str,
    query: str,
    top_k: int = 5,
) -> list[_Scored]:
    """MOCK suggester.

    Returns up to top_k enabled items for the package, with descending
    synthetic scores (0.9, 0.8, 0.7, ...). Filters out items whose
    point_count is 0 unless query is non-empty.
    """
    items_result = await db.execute(
        select(AuditItem)
        .where(AuditItem.package_code == package_code)
        .where(AuditItem.is_enabled.is_(True))
        .order_by(AuditItem.sort_order.asc(), AuditItem.id.asc())
    )
    items = list(items_result.scalars())

    if not items:
        return []

    counts_result = await db.execute(
        select(AuditPoint.item_id, func.count(AuditPoint.id))
        .where(AuditPoint.package_code == package_code)
        .group_by(AuditPoint.item_id)
    )
    counts = {row[0]: int(row[1]) for row in counts_result.all()}

    scored: list[_Scored] = []
    for idx, item in enumerate(items[:top_k]):
        aliases = list(item.aliases or [])
        scored.append(
            _Scored(
                item=item,
                point_count=counts.get(item.id, 0),
                score=round(max(0.1, 0.9 - idx * 0.1), 2),
                matched_aliases=aliases[:2],
                matched_terms=[item.name_cn],
            )
        )
    return scored