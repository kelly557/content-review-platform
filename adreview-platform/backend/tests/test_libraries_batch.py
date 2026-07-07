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
        group_id=1,
        libraries=[
            LibraryBatchItem(
                code="lib_w99001",
                name="批量测试1",
                library_type="word",
                words=["foo", "bar"],
            ),
            LibraryBatchItem(
                code="lib_w99002",
                name="批量测试2",
                library_type="word",
            ),
        ],
    )
    assert body.group_id == 1
    assert len(body.libraries) == 2
    assert body.libraries[0].words == ["foo", "bar"]

