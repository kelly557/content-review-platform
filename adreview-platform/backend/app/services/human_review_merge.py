"""合并策略默认与任务级/触发器级 override，生成最终的 human_review dict。

合并语义（per-field override）：

- is_enabled / risk_levels / sensitive_levels / review_rule_id / sample_ratio：
  override 字段非空才覆盖；空值（None / 空列表 / 空 dict）走 strategy 默认
- auto_action_overrides：深合并（cell 级别）—— override 的 cell 覆盖 strategy 的同 cell；
  其他 cell 保留 strategy

合并后必须再走 ``HumanReviewSettings.normalized()`` 做一致性清洗
（关人审时清空 risk_levels 等），保证下游读取一致。

调用点：
- ``backend/app/api/v1/materials.py:submit_material`` —— 任务级 override
- ``backend/app/api/v1/material_packages.py:submit_package`` —— 批量提交 override
- ``backend/app/services/trigger_engine.py`` —— trigger 级 override
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from app.schemas.strategy import HumanReviewSettings


def _non_empty_list(v: Any) -> bool:
    """判断列表字段是否\"非空覆盖\"。None 和 [] 都视为空。"""
    return v is not None and len(v) > 0


def _non_empty_dict(v: Any) -> bool:
    return v is not None and len(v) > 0


def merge_human_review(
    strategy_hr: Optional[Dict[str, Any]],
    override_hr: Optional[HumanReviewSettings],
) -> Dict[str, Any]:
    """合并 strategy 默认与 override，返回清洗前的 dict。

    返回值会进一步传给 ``HumanReviewSettings.normalized()`` 做最终一致性。

    合并规则：
    - 字段级覆盖：override 的非空字段覆盖 strategy；空字段走 strategy
    - auto_action_overrides：深合并（cell 级别）
    - \"空 override\"（model_fields_set 为空）→ 视为「无操作」，保留 strategy 全部内容
    - \"显式 override\"（任一字段被设置）→ is_enabled 也参与比较，
      即 ``HumanReviewSettings(is_enabled=False)`` 可以关掉 strategy 的人审
    """
    base = dict(strategy_hr or {})
    if override_hr is None:
        return base

    out = dict(base)

    # is_enabled：仅当 override 显式设置时才覆盖
    if override_hr.has_any_value():
        if "is_enabled" in override_hr.model_fields_set:
            out["is_enabled"] = bool(override_hr.is_enabled)

    if _non_empty_list(override_hr.risk_levels):
        out["risk_levels"] = list(override_hr.risk_levels)

    if _non_empty_list(override_hr.sensitive_levels):
        out["sensitive_levels"] = list(override_hr.sensitive_levels)

    if override_hr.review_rule_id is not None:
        out["review_rule_id"] = override_hr.review_rule_id

    if override_hr.sample_ratio is not None:
        out["sample_ratio"] = float(override_hr.sample_ratio)

    if _non_empty_dict(override_hr.auto_action_overrides):
        base_overrides = dict(out.get("auto_action_overrides") or {})
        base_overrides.update(dict(override_hr.auto_action_overrides or {}))
        out["auto_action_overrides"] = base_overrides

    return out


def merge_and_normalize_human_review(
    strategy_hr: Optional[Dict[str, Any]],
    override_hr: Optional[HumanReviewSettings],
) -> Dict[str, Any]:
    """合并 + 标准化，生成下游可直接使用的最终 dict。

    WorkflowInstance.strategy_human_review 写入这个返回值。
    """
    merged = merge_human_review(strategy_hr, override_hr)
    return HumanReviewSettings.model_validate(merged).normalized().model_dump()