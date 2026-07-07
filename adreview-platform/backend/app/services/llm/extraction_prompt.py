"""Knowledge extraction prompt + JSON schema.

The schema intentionally uses ``additionalProperties: false`` so the
OpenAI ``json_schema`` engine can enforce strict shape.
"""
from __future__ import annotations

from typing import Any, Dict


SYSTEM_PROMPT = (
    "你是「广告合规审核规则抽取专家」。"
    "用户会提供一份法规、法律、行业规范或内部政策的文档（可能是节选）。"
    "请把文档中每一条**可机器化执行**的合规约束拆解为两层结构："
    "1) 审核项（一级分类，如「绝对化用语」「医疗承诺」「数据隐私」），"
    "2) 审核点（可机器判断的具体规则，属于某个审核项）。"
    "对每个审核点必须给出：\n"
    "- label_cn: 中文名\n"
    "- description: 一句话描述\n"
    "- judgment_logic: 机器判断逻辑（结构化对象，type ∈ keyword_match|regex|semantic|threshold，"
    "  expr 为可执行的表达式或关键词列表，params 为附加参数）\n"
    "- judgment_rule: 用自然语言描述判断规则\n"
    "- judgment_basis: 判断依据，**必须引用文档原文或条款编号**\n"
    "- risk_level: 低风险 | 中风险 | 高风险\n"
    "- scope_text: 适用场景（广告文案 / 视频字幕 / 落地页 ...）\n"
    "如果文档没有可机器执行的规则，返回 {\"items\": []}。**只输出 JSON**，不要任何额外解释。"
)


def _point_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "label_cn",
            "description",
            "judgment_logic",
            "judgment_rule",
            "judgment_basis",
            "risk_level",
            "scope_text",
        ],
        "properties": {
            "label_cn": {"type": "string", "minLength": 1, "maxLength": 64},
            "description": {"type": "string"},
            "judgment_logic": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "expr", "params"],
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["keyword_match", "regex", "semantic", "threshold"],
                    },
                    "expr": {"type": "string"},
                    "params": {"type": "object"},
                },
            },
            "judgment_rule": {"type": "string"},
            "judgment_basis": {"type": "string"},
            "risk_level": {
                "type": "string",
                "enum": ["低风险", "中风险", "高风险"],
            },
            "scope_text": {"type": "string"},
        },
    }


def _item_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["name_cn", "description", "aliases", "points"],
        "properties": {
            "name_cn": {"type": "string", "minLength": 1, "maxLength": 64},
            "code": {"type": "string"},
            "description": {"type": "string"},
            "aliases": {"type": "array", "items": {"type": "string"}},
            "points": {"type": "array", "items": _point_schema()},
        },
    }


def get_extraction_schema() -> Dict[str, Any]:
    """Top-level JSON schema for the MaaS extraction call."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["items"],
        "properties": {
            "items": {"type": "array", "items": _item_schema()},
        },
    }


def build_user_prompt(
    document_text: str,
    *,
    domain: str,
    scope: str,
    extra_hint: str = "",
) -> str:
    hint = f"\n额外提示：{extra_hint}" if extra_hint else ""
    return (
        f"知识领域: {domain}\n"
        f"文档类型: {scope}\n"
        "请从下面的文档中抽取审核项与审核点。\n"
        "----- 文档开始 -----\n"
        f"{document_text}\n"
        "----- 文档结束 -----"
        f"{hint}"
    )