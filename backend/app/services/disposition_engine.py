"""Disposition engine (Phase B).

组合 strategy 上的 disposition_rule 和任务/触发器级的 override_disposition，
生成最终下游可用的 human_review dict。

设计要点：
- 读两表 → 转字典 → 与 ``human_review_merge.merge_human_review`` 同语义字段级覆盖
- auto_action_overrides：cell 级深合并（与现版一致）
- 最后走 ``HumanReviewSettings.normalized().model_dump()`` 做一致性清洗
- 兼容旧路径：strategy 是 None / override 是 None 都允许

调用点（PR B2 仅暴露 service，B3 才会替换现版 merge_and_normalize_human_review 的
旧 callers）：
- 后续 PR B3 接管 ``backend/app/services/workflow_engine.py`` 写 instance.strategy_human_review
- 后续 PR B5 接管 triggers / material_packages 的 inline override 字段
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import DispositionRule
from app.schemas.strategy import HumanReviewSettings


def _row_to_dict(d: DispositionRule) -> Dict[str, Any]:
    return {
        "is_enabled": bool(d.is_enabled),
        "risk_levels": list(d.risk_levels or []),
        "sensitive_levels": list(d.sensitive_levels or []),
        "review_rule_id": d.review_rule_id,
        "sample_ratio": float(d.sample_ratio) if d.sample_ratio is not None else None,
        "auto_action_overrides": dict(d.auto_action_overrides or {}),
    }


def _non_empty_list(v: Any) -> bool:
    return v is not None and len(v) > 0


def _non_empty_dict(v: Any) -> bool:
    return v is not None and len(v) > 0


async def load_disposition_dict(
    db: AsyncSession, disposition_id: int | None
) -> Optional[Dict[str, Any]]:
    """把 disposition_rules 行转成 human_review dict。

    disposition_id 为 None → 返回 None（调用方走「无默认」语义）。
    """
    if disposition_id is None:
        return None
    d = await db.get(DispositionRule, disposition_id)
    if d is None:
        return None
    return _row_to_dict(d)


def merge_disposition_dicts(
    base: Optional[Dict[str, Any]],
    override: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """字段级覆盖合并（与 human_review_merge.merge_human_review 等价，但输入是 dict-of-dict）。

    - base / override 都是可选 None
    - 若 override 为 None → 直接返回 base（或空 dict）
    - 任何字段 override 给出非空值才会覆盖 base
    - is_enabled：override 显式提供才覆盖
    - auto_action_overrides：cell 级深合并
    """
    if not base and not override:
        return {}
    out: Dict[str, Any] = dict(base or {})

    if not override:
        return out

    if "is_enabled" in override:
        out["is_enabled"] = bool(override["is_enabled"])

    risk_levels = override.get("risk_levels")
    if _non_empty_list(risk_levels):
        out["risk_levels"] = list(risk_levels)

    sensitive_levels = override.get("sensitive_levels")
    if _non_empty_list(sensitive_levels):
        out["sensitive_levels"] = list(sensitive_levels)

    review_rule_id = override.get("review_rule_id")
    if review_rule_id is not None:
        out["review_rule_id"] = review_rule_id

    sample_ratio = override.get("sample_ratio")
    if sample_ratio is not None:
        out["sample_ratio"] = float(sample_ratio)

    auto_overrides = override.get("auto_action_overrides")
    if _non_empty_dict(auto_overrides):
        base_overrides = dict(out.get("auto_action_overrides") or {})
        base_overrides.update(dict(auto_overrides))
        out["auto_action_overrides"] = base_overrides

    return out


def normalize_disposition_dict(payload: Dict[str, Any]) -> Dict[str, Any]:
    """统一清洗：与 HumanReviewSettings.normalized() 等价。"""
    return HumanReviewSettings.model_validate(payload).normalized().model_dump()


async def compose_effective(
    db: AsyncSession,
    strategy_disposition_id: int | None,
    override_disposition_id: int | None,
) -> Dict[str, Any]:
    """组合策略级与 override 级的处置规则，输出最终下游 dict。

    用法：
        merged = await compose_effective(db, strategy.disposition_rule_id,
                                         task.override_disposition_id)
        instance.strategy_human_review = merged
    """
    base = await load_disposition_dict(db, strategy_disposition_id)
    ov = await load_disposition_dict(db, override_disposition_id)
    merged = merge_disposition_dicts(base, ov)
    if not merged:
        return {
            "is_enabled": False,
            "risk_levels": [],
            "sensitive_levels": [],
            "review_rule_id": None,
            "sample_ratio": None,
            "auto_action_overrides": {},
        }
    return normalize_disposition_dict(merged)
