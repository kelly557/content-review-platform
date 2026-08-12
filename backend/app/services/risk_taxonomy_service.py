"""Shared risk label taxonomy service.

Builds the three-level risk label tree (审核项 → 审核点 → sub审核点)
from ``audit_items`` + ``audit_points`` tables, with cross-package
de-duplication by ``name_cn`` / ``label_cn``.

Used by:
  - ``/query/risk-taxonomy`` (query page filter options)
  - ``/reports/risk-trend/options`` (report page filter options)
  - ``/query/results`` (risk label column rendering + filtering)
  - ``/reports/risk/trend`` / ``/reports/anomaly`` / ``/reports/risk/top-labels``
  - ``/alerts`` (alert list filtering)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.schemas.query import RiskTaxonomyNode


async def load_risk_taxonomy(db: AsyncSession) -> List[RiskTaxonomyNode]:
    """Build the three-level risk label tree with de-duplication.

    Hierarchy:
      - Level 1 (审核项): ``audit_items``, de-duped by ``name_cn``.
      - Level 2 (审核点): ``audit_points`` where ``parent_point_id IS NULL``,
        de-duped by ``label_cn`` within each level-1 node.
      - Level 3 (sub审核点): ``audit_points`` where ``parent_point_id IS NOT NULL``,
        de-duped by ``label_cn`` within each level-2 node.

    When de-duping, the first occurrence (by ``sort_order, id``) wins for
    ``code`` / ``id``; all subsequent same-name entries are merged into it.

    Returns a list of :class:`RiskTaxonomyNode` with ``path`` being the
    slash-joined code chain (e.g. ``sm_l1_shezheng/sm_l2_shezheng_yihaolingdao``).
    """
    # ── Level 1: audit_items, de-duped by name_cn ──
    item_rows = (
        await db.execute(
            select(AuditItem)
            .order_by(AuditItem.sort_order.asc(), AuditItem.id.asc())
        )
    ).scalars().all()

    # Build de-duped level-1 nodes; map all item_ids → representative node.
    # key = name_cn; value = (RiskTaxonomyNode, list of item_ids that merged in)
    l1_by_name: Dict[str, RiskTaxonomyNode] = {}
    l1_by_item_id: Dict[int, RiskTaxonomyNode] = {}
    l1_order: List[str] = []  # preserve first-seen order
    for item in item_rows:
        name = item.name_cn or item.code
        if name in l1_by_name:
            # merge: just record this item_id under the existing node
            l1_by_item_id[item.id] = l1_by_name[name]
        else:
            node = RiskTaxonomyNode(
                code=item.code,
                label=name,
                path=item.code,
                children=[],
            )
            l1_by_name[name] = node
            l1_by_item_id[item.id] = node
            l1_order.append(name)

    # ── Level 2: top-level audit_points (parent_point_id IS NULL) ──
    top_point_rows = (
        await db.execute(
            select(AuditPoint)
            .where(AuditPoint.parent_point_id.is_(None))
            .order_by(AuditPoint.sort_order.asc(), AuditPoint.id.asc())
        )
    ).scalars().all()

    # Group top-level points by their parent item's representative node,
    # then de-dup by label_cn within each node.
    # Map: point_id → level-2 RiskTaxonomyNode (for sub-point attachment)
    l2_by_point_id: Dict[int, RiskTaxonomyNode] = {}
    for p in top_point_rows:
        parent_node = l1_by_item_id.get(p.item_id)
        if parent_node is None:
            continue
        label = p.label_cn or p.label or p.code
        # de-dup by label within this parent node
        existing = next(
            (c for c in parent_node.children if c.label == label), None
        )
        if existing is not None:
            l2_by_point_id[p.id] = existing
        else:
            child = RiskTaxonomyNode(
                code=p.code,
                label=label,
                path=f"{parent_node.path}/{p.code}",
                children=[],
            )
            parent_node.children.append(child)
            l2_by_point_id[p.id] = child

    # ── Level 3: sub audit_points (parent_point_id IS NOT NULL) ──
    sub_point_rows = (
        await db.execute(
            select(AuditPoint)
            .where(AuditPoint.parent_point_id.is_not(None))
            .order_by(AuditPoint.sort_order.asc(), AuditPoint.id.asc())
        )
    ).scalars().all()

    for sp in sub_point_rows:
        parent_node = l2_by_point_id.get(sp.parent_point_id)
        if parent_node is None:
            continue
        label = sp.label_cn or sp.label or sp.code
        # de-dup by label within this parent node
        existing = next(
            (c for c in parent_node.children if c.label == label), None
        )
        if existing is not None:
            continue
        parent_node.children.append(
            RiskTaxonomyNode(
                code=sp.code,
                label=label,
                path=f"{parent_node.path}/{sp.code}",
            )
        )

    return [l1_by_name[name] for name in l1_order]


def collect_point_codes_under_paths(
    taxonomy: List[RiskTaxonomyNode],
    selected_paths: List[str],
) -> List[str]:
    """Resolve selected paths to a flat list of ``audit_point_code`` values.

    Traverses the three-level tree. When a level-3 (sub) node is selected,
    its parent level-2 code is also included — because ``machine_result.hits``
    stores the level-2 ``audit_point_code`` (LLM is prompted with level-2
    points only), so filtering by a sub-point must also match its parent's
    code.

    Selecting a level-1 or level-2 node expands to all descendant codes.
    """
    if not selected_paths:
        return []

    # Build path → node index
    by_path: Dict[str, RiskTaxonomyNode] = {}
    queue: List[RiskTaxonomyNode] = list(taxonomy)
    while queue:
        node = queue.pop()
        by_path[node.path] = node
        queue.extend(node.children)

    out: List[str] = []
    seen: set[str] = set()

    def _add_code(code: str) -> None:
        if code and code not in seen:
            seen.add(code)
            out.append(code)

    for path in selected_paths:
        node = by_path.get(path)
        if node is None:
            continue
        _collect_codes_recursive(node, by_path, _add_code)

    return out


def _collect_codes_recursive(
    node: RiskTaxonomyNode,
    by_path: Dict[str, RiskTaxonomyNode],
    add_fn,
) -> None:
    """Recursively collect codes from a node and all its descendants.

    For level-3 nodes: add the node's own code + its parent's code.
    For level-2 nodes: add the node's own code + all descendant codes.
    For level-1 nodes: add all descendant codes (level-1 code is not
    stored in hits, so it's not added directly).
    """
    if not node.children:
        # Leaf node — add its own code.
        # Also find and add its parent's code (level-2), because hits
        # store the level-2 audit_point_code.
        _add_with_parent(node, by_path, add_fn)
        return

    # Non-leaf: if this is a level-2 node (has children = sub-points),
    # add its own code too (hits may reference it directly).
    # Detect level: level-1 nodes have path = single segment (no '/');
    # level-2 nodes have path with one '/'.
    if "/" in node.path:
        # level-2 node — hits store this code
        add_fn(node.code)

    for child in node.children:
        _collect_codes_recursive(child, by_path, add_fn)


def _add_with_parent(
    node: RiskTaxonomyNode,
    by_path: Dict[str, RiskTaxonomyNode],
    add_fn,
) -> None:
    """Add a leaf node's code and its parent's code."""
    add_fn(node.code)
    # Find parent by stripping the last path segment
    parent_path = node.path.rsplit("/", 1)[0] if "/" in node.path else None
    if parent_path:
        parent = by_path.get(parent_path)
        if parent:
            add_fn(parent.code)
