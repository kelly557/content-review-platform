"""Material-to-strategy routing.

Given a material and a trigger, decide which Strategy (if any) applies.

Five standard keys (read from Material.extra_metadata / Material.tags):

  - material_type:    Material.material_type
  - business_line:    Material.extra_metadata["business_line"]
  - country:          Material.extra_metadata["country"]
  - channel:          Material.extra_metadata["channel"]
  - content_category: Material.tags["content_category"]

Match semantics (intentionally simple per product decision):

  - All configured keys must match (logical AND).
  - A configured key whose value is missing on the material is treated
    as "not specified" → does NOT block the match.
  - Empty match_conditions = match every material.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.material import Material
from app.models.strategy import Strategy
from app.models.trigger import Trigger


# Five standard routing keys (per product decision).
ROUTING_KEYS = {
    "material_type",
    "business_line",
    "country",
    "channel",
    "content_category",
}


def extract_material_attributes(material: Material) -> Dict[str, list[str]]:
    """Return the 5-key attribute dict from a material.

    Values are normalized to lists so the match logic is uniform.
    """
    extra = material.extra_metadata or {}
    tags = material.tags or {}

    def _as_list(val: Any) -> list[str]:
        if val is None:
            return []
        if isinstance(val, list):
            return [str(v) for v in val]
        return [str(val)]

    return {
        "material_type": [str(material.material_type.value)] if material.material_type else [],
        "business_line": _as_list(extra.get("business_line")),
        "country": _as_list(extra.get("country")),
        "channel": _as_list(extra.get("channel")),
        "content_category": _as_list(tags.get("content_category")),
    }


def match_conditions(
    material_attrs: Dict[str, list[str]],
    conditions: Dict[str, list[str]],
) -> bool:
    """Return True iff every non-empty condition is satisfied.

    - Empty conditions  → True (matches everything).
    - For each key in conditions: at least one value must appear in
      the material's attributes for that key. If the material has no
      attributes for that key, the condition is treated as not
      blocking (skip).
    """
    if not conditions:
        return True
    for key, want in conditions.items():
        if not want:
            continue
        material_vals = material_attrs.get(key, [])
        if not material_vals:
            # Material does not specify this dimension — skip.
            continue
        if not any(w in material_vals for w in want):
            return False
    return True


async def resolve_strategy_for_trigger(
    db: AsyncSession, trigger: Trigger, material: Material
) -> Optional[Strategy]:
    """Pick a Strategy for a material under a trigger.

    Returns:
      - trigger.strategy_id Strategy if conditions match
      - None otherwise (caller should fall back to default)
    """
    if not trigger.is_enabled:
        return None
    if trigger.strategy_id is None:
        return None

    attrs = extract_material_attributes(material)
    if not match_conditions(attrs, trigger.match_conditions or {}):
        return None

    return await db.get(Strategy, trigger.strategy_id)