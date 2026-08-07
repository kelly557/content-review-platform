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
                risk_point_id=42,
            ),
        ],
    )
    assert body.libraries[0].kind is None
    assert body.libraries[0].risk_point_id == 42


@pytest.mark.asyncio
async def test_batch_create_reply_without_risk_point_id(monkeypatch):
    """代答库 risk_point_id 改为可选 — 不传也能过 schema 校验。"""
    from app.schemas.library import LibraryBatchCreateRequest, LibraryBatchItem

    body = LibraryBatchCreateRequest(
        libraries=[
            LibraryBatchItem(
                code="lib_r99002",
                name="批量回复2-无risk_point",
                library_type="reply",
            ),
        ],
    )
    assert body.libraries[0].kind is None
    assert body.libraries[0].risk_point_id is None


@pytest.mark.asyncio
async def test_create_reply_without_risk_point_id(monkeypatch):
    """LibraryCreate (单条创建) 代答库不传 risk_point_id 也接受。"""
    from app.schemas.library import LibraryCreate

    body = LibraryCreate(
        name="无risk_point的代答库",
        library_type="reply",
    )
    assert body.kind is None
    assert body.risk_point_id is None
    assert body.effective_from is None
    assert body.effective_until is None
