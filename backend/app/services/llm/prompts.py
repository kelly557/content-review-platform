"""Build the (system, user) prompt pair for the MaaS moderation call.

The system message is a stable role definition; the user message embeds the
text + the enabled services list + a JSON schema that exactly matches
``ModerationResult``.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings


# 单次 prompt 内最多下发的审核点条数, 防 prompt 膨胀.
_MAX_AUDIT_POINTS_IN_PROMPT = 50


_SYSTEM = """你是 AdReview 平台的内容合规审核引擎，基于中国《广告法》《互联网广告管理办法》、
《医疗广告管理办法》《网络借贷信息中介机构业务活动管理暂行办法》等法规，对输入的
素材文本进行结构化判断。

输出必须是严格的 JSON 对象，键名/类型严格符合下方 schema；不要包含任何额外字段或解释文字。

【输出安全约束 — 最高优先级】
你的输出会被网关二次内容审查。为避免被拦截，输出中**严禁以任何形式复述、引用、
拼写出待审文本里的违规原文词句**（包括但不限于绝对化用语、违禁词、敏感词、PII）。
- 违规片段一律用 ``start`` / ``length`` 两个数字定位，绝不写出违规文字本身。
- ``label_cn`` / ``summary`` 等字段只能用**类别化、抽象化**的描述
  （如"医疗绝对化宣称""绝对化用语"），不得复述原文。
- 例外：非违规的服务名、普通词汇可以正常出现。"""


def build_moderation_prompt(
    text_body: str,
    enabled_services: list[str],
    audit_points: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[str, str]:
    truncated = text_body
    if len(text_body) > settings.maas_max_text_chars:
        truncated = text_body[: settings.maas_max_text_chars]
        truncated += "\n\n[…原文已截断，仅审核以上片段…]"

    services_json = json.dumps(
        [
            {
                "code": s,
                "name": _SERVICE_NAME_HINT.get(s, s),
            }
            for s in enabled_services
        ],
        ensure_ascii=False,
    )

    rules_block = _format_audit_points(audit_points)

    user = f"""待审核文本（已截断到 {len(truncated)} 字符）：

\"\"\"{truncated}\"\"\"

启用的检测服务（每个服务负责一类风险）：
{services_json}
{rules_block}
请输出 JSON，schema 严格如下：

{{
  "risk_level": "高风险|中风险|低风险|敏感|无风险",
  "sensitive_level": "S0|S1|S2|S3",
  "hits": [
    {{
      "service_code": "<对应启用服务 code>",
      "service_name": "<对应服务中文名>",
      "audit_point_code": "<必须从上方审核点列表的 code 中选取一个>",
      "label": "<机器码，例如 medical_absolute_claim>",
      "label_cn": "<中文违规名，例如 医疗绝对化宣称>",
      "score": 0.0,
      "start": <违规片段在待审文本中的起始字符位置，整数，从 0 起>,
      "length": <违规片段字符长度，整数，≥1>,
      "sensitive_grade": "S0|S1|S2|S3",
      "risk": "高风险|中风险|低风险|敏感|无风险 (可选)"
    }}
  ],
  "rule_hits": [
    {{
      "rule_id": 0,
      "label": "<机器码>",
      "label_cn": "<中文规则名>",
      "threshold": 0.5,
      "matched": true,
      "sensitive_grade": "S0|S1|S2|S3"
    }}
  ],
  "summary": "<一句话中文摘要，最多 80 字>"
}}

约束：
1. 没命中就 hits=[] / rule_hits=[]，不要为低分硬凑命中。
2. score 在 [0, 1] 之间，越高越确定。
3. sensitive_grade：PII-only（身份证/手机号/住址）→ S1；明显违规 → S2；高危合规事件 → S3；其他 → S0。
4. 不输出 schema 之外的字段。
5. 直接以 ``{{`` 开头，不要加 markdown 围栏。
6. `risk_level` 字段不得低于所有 hit.risk 字段的最高档。
7. **严禁在输出任何字段里复述违规原文**；违规片段只用 ``start``+``length`` 定位。
   ``start`` 是字符偏移（从 0 起），``length`` 是违规词的字符数。
   例：待审文本"全网第一最好"，"第一"在位置 2、长度 2 → ``"start": 2, "length": 2``。
8. ``summary`` 用类别化描述（如"含绝对化用语与医疗宣称"），不得包含违规原文词句。
9. **每条 hit 的 ``audit_point_code`` 必须从上方"本策略启用的审核点"列表的 code 中选取**，
   不得自行编造。若审核点列表为空，则 ``audit_point_code`` 留空字符串。"""
    return _SYSTEM, user


_SERVICE_NAME_HINT: dict[str, str] = {
    "text_detection_pro": "通用文本审核",
    "image_audit_pro": "图像内容审核",
    "audio_audit_pro": "音频内容审核",
    "document_audit_pro": "图文拼版审核",
    "video_audit_pro": "视频内容审核",
}


def _format_audit_points(
    audit_points: Optional[List[Dict[str, Any]]],
) -> str:
    """把策略启用的审核点渲染成 prompt 里的规则清单段落.

    每条至少含 ``label_cn``; 可选 ``code`` / ``description`` / ``risk_level`` /
    ``medium_threshold`` / ``high_threshold``. 控制在
    ``_MAX_AUDIT_POINTS_IN_PROMPT`` 条以内防爆 prompt; 超出截断并提示.

    传 None 或空列表时返回空字符串 (向后兼容: machine_review 不传该参数,
    prompt 与旧版完全一致).
    """
    if not audit_points:
        return ""
    rows: List[str] = []
    shown = 0
    total = len(audit_points)
    for p in audit_points:
        if shown >= _MAX_AUDIT_POINTS_IN_PROMPT:
            break
        label_cn = (p.get("label_cn") or "").strip()
        if not label_cn:
            continue
        code = (p.get("code") or "").strip()
        desc = (p.get("description") or "").strip()
        risk = (p.get("risk_level") or "").strip()
        parts: List[str] = []
        if code:
            parts.append(f"code={code}")
        parts.append(f"name={label_cn}")
        if risk:
            parts.append(f"risk={risk}")
        if desc:
            # 描述截到 80 字, 防单条过长.
            parts.append(f"desc={desc[:80]}")
        rows.append(f"  - " + " | ".join(parts))
        shown += 1
    if not rows:
        return ""
    head = "本策略启用的审核点（命中即视为违规，请逐条核对）："
    tail = ""
    if total > shown:
        tail = f"\n（共 {total} 条，已展示前 {shown} 条）"
    return f"\n{head}\n" + "\n".join(rows) + tail + "\n"
