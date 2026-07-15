"""Build the (system, user) prompt pair for the MaaS moderation call.

The system message is a stable role definition; the user message embeds the
text + the enabled services list + a JSON schema that exactly matches
``ModerationResult``.
"""
from __future__ import annotations

import json
from typing import Tuple

from app.core.config import settings


_SYSTEM = """你是 AdReview 平台的内容合规审核引擎，基于中国《广告法》《互联网广告管理办法》、
《医疗广告管理办法》《网络借贷信息中介机构业务活动管理暂行办法》等法规，对输入的
素材文本进行结构化判断。

输出必须是严格的 JSON 对象，键名/类型严格符合下方 schema；不要包含任何额外字段或解释文字。
命中片段的 quote 必须是输入文本中真实存在的子串，禁止臆造。"""


def build_moderation_prompt(text_body: str, enabled_services: list[str]) -> Tuple[str, str]:
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

    user = f"""待审核文本（已截断到 {len(truncated)} 字符）：

\"\"\"{truncated}\"\"\"

启用的检测服务（每个服务负责一类风险）：
{services_json}

请输出 JSON，schema 严格如下：

{{
  "risk_level": "高风险|中风险|低风险|敏感|无风险",
  "sensitive_level": "S0|S1|S2|S3",
  "hits": [
    {{
      "service_code": "<对应启用服务 code>",
      "service_name": "<对应服务中文名>",
      "label": "<机器码，例如 medical_absolute_claim>",
      "label_cn": "<中文违规名，例如 医疗绝对化宣称>",
      "score": 0.0,
      "quote": "<必须是上面待审核文本中真实存在的子串，最长 60 字>",
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
6. `risk_level` 字段不得低于所有 hit.risk 字段的最高档。"""
    return _SYSTEM, user


_SERVICE_NAME_HINT: dict[str, str] = {
    "text_detection_pro": "通用文本审核",
    "image_audit_pro": "图像内容审核",
    "audio_audit_pro": "音频内容审核",
    "document_audit_pro": "图文拼版审核",
    "video_audit_pro": "视频内容审核",
}
