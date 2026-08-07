"""Schemas for uploaded documents (自定义规则 Agent — 文件上传与解析)。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.uploaded_document import UploadedDocKind, UploadedDocStatus


DEFAULT_LLM_PROMPT = """# 角色

你是一名内容安全审核专家，请从用户提供的文档中提取结构化「审核点」。

# 输出要求

每个审核点包含两个字段：

- `label_cn`：审核点名称（简短，描述要审核的内容，≤ 30 字）
- `scope_text`：审核内容描述（具体的审核标准或判断依据，≤ 200 字）

# 输出格式

请以 **JSON 数组** 形式返回，每个元素形如：

```json
[
  {"label_cn": "不得含有虚假宣传内容", "scope_text": "经营者不得对商品的性能、功能、质量作虚假或引人误解的商业宣传..."},
  ...
]
```

如果文档中无法提取出有效审核点，返回空数组 `[]`。
"""


class UploadedDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_id: int
    package_code: str
    original_filename: str
    kind: UploadedDocKind
    storage_key: str
    size_bytes: int
    sha256: Optional[str] = None
    mime_type: Optional[str] = None
    status: UploadedDocStatus
    parsed_point_count: int
    error_message: Optional[str] = None
    parsed_at: Optional[datetime] = None
    prompt_markdown: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class UploadedDocumentUpdate(BaseModel):
    """可更新的字段：仅 prompt_markdown。"""

    model_config = ConfigDict(extra="forbid")

    prompt_markdown: Optional[str] = Field(default=None, max_length=20_000)


class UploadedDocumentListResponse(BaseModel):
    """某个 AuditItem 下的所有上传文件。"""

    item_id: int
    documents: list[UploadedDocumentOut]
    total_count: int
    parsed_count: int
    failed_count: int
    pending_count: int