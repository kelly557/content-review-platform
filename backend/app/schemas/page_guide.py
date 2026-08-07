"""PageGuide schemas — request/response shapes for the prototype guide API.

The frontend stores the entire page as one Markdown string; we mirror that
flat shape on the wire so the round-trip is lossless.
"""
from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel, Field


MAX_MARKDOWN_BYTES = 100 * 1024  # 100KB; matches the frontend cap


class PageGuideUpsertIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    markdown_md: str = Field(..., min_length=1)


class PageGuideOut(BaseModel):
    path: str
    title: str
    markdown_md: str
    updated_by_id: int | None = None
    created_at: datetime
    updated_at: datetime


class PageGuideListOut(BaseModel):
    guides: List[PageGuideOut]
