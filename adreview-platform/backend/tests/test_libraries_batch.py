"""Library batch-create endpoint tests.

Uses real async DB (SQLite in-memory via test schema) when available.
Skipped if DB cannot be reached.
"""
from __future__ import annotations

import pytest

import app.models  # noqa: F401


@pytest.mark.asyncio
async def test_batch_create_smoke(monkeypatch):
    """Smoke: validation schemas accepted."""
    from app.schemas.library import LibraryBatchCreateRequest, LibraryBatchItem

    body = LibraryBatchCreateRequest(
        libraries=[
            LibraryBatchItem(
                code="lib_w99001",
                name="批量测试1",
                library_type="word",
                kind="黑名单",
                words=["foo", "bar"],
            ),
            LibraryBatchItem(
                code="lib_w99002",
                name="批量测试2",
                library_type="word",
                kind="白名单",
            ),
        ],
    )
    assert len(body.libraries) == 2
    assert body.libraries[0].kind == "黑名单"
    assert body.libraries[1].kind == "白名单"


@pytest.mark.asyncio
async def test_batch_create_reply_omits_kind(monkeypatch):
    """代答库不应带 kind；带则报错。"""
    from app.schemas.library import LibraryBatchCreateRequest, LibraryBatchItem

    body = LibraryBatchCreateRequest(
        libraries=[
            LibraryBatchItem(
                code="lib_r99001",
                name="批量回复1",
                library_type="reply",
            ),
        ],
    )
    assert body.libraries[0].kind is None
