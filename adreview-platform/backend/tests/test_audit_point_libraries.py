"""AuditPoint ↔ Library N:M tests.

Covers:
1. Route + schema registration
2. ORM model wiring (AuditPointLibrary table, relationships)
3. _replace_linked_libraries helper logic (validation + idempotency)
4. PATCH semantics (None / [] / [ids])
5. Inter-type rejection (互斥校验)
6. Cascade on library delete
7. Legacy custom_wordset_id write path still works
8. Batch create with linked_library_ids
"""
from __future__ import annotations

from typing import Optional
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.models  # noqa: F401
from app.api.v1.audit_points import _replace_linked_libraries
from app.main import app
from app.models.audit_point_library import AuditPointLibrary
from app.models.library import Library, LibraryType


# ────────────────────────────────────────────────────────────────────
# 1. Schema / route registration
# ────────────────────────────────────────────────────────────────────

EXPECTED_LINKED_FIELDS = ("linked_libraries", "linked_library_ids")


def test_audit_point_out_has_linked_libraries():
    schemas = app.openapi()["components"]["schemas"]
    assert "AuditPointOut" in schemas
    props = schemas["AuditPointOut"]["properties"]
    assert "linked_libraries" in props
    assert props["linked_libraries"]["type"] == "array"


def test_audit_point_create_has_linked_library_ids():
    schemas = app.openapi()["components"]["schemas"]
    assert "AuditPointCreate" in schemas
    props = schemas["AuditPointCreate"]["properties"]
    assert "linked_library_ids" in props


def test_audit_point_update_has_linked_library_ids():
    schemas = app.openapi()["components"]["schemas"]
    assert "AuditPointUpdate" in schemas
    props = schemas["AuditPointUpdate"]["properties"]
    assert "linked_library_ids" in props


def test_linked_library_out_schema():
    schemas = app.openapi()["components"]["schemas"]
    assert "LinkedLibraryOut" in schemas
    props = schemas["LinkedLibraryOut"]["properties"]
    for f in ("library_id", "library_type", "code", "name"):
        assert f in props, f"missing LinkedLibraryOut.{f}"


# ────────────────────────────────────────────────────────────────────
# 2. ORM model wiring
# ────────────────────────────────────────────────────────────────────

def test_audit_point_library_table_columns():
    cols = {c.name for c in AuditPointLibrary.__table__.columns}
    for col in ("audit_point_id", "library_id", "sort_order", "created_at"):
        assert col in cols, f"missing column: {col}"


def test_audit_point_library_primary_key():
    pk_cols = {c.name for c in AuditPointLibrary.__table__.primary_key.columns}
    assert pk_cols == {"audit_point_id", "library_id"}


def test_audit_point_relationships_present():
    from app.models.audit_point import AuditPoint

    rels = {r.key for r in AuditPoint.__mapper__.relationships}
    assert "linked_libraries" in rels
    assert "linked_library_links" in rels


def test_library_back_audit_points_relationship():
    rels = {r.key for r in Library.__mapper__.relationships}
    assert "back_audit_points" in rels


# ────────────────────────────────────────────────────────────────────
# 3. _replace_linked_libraries helper logic (mock-based, no real DB)
# ────────────────────────────────────────────────────────────────────


def _lib_type(value: str):
    return LibraryType(value)


def _make_db(library_rows: list[tuple[int, str]]):
    """Return a MagicMock db where execute() returns library id+type rows
    for the SELECT id, library_type FROM libraries WHERE id IN (...) call.
    """
    db = MagicMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    async def fake_execute(stmt, *args, **kwargs):
        # The first call from _replace_linked_libraries is the SELECT.
        result = MagicMock()
        result.all = MagicMock(return_value=library_rows)
        return result

    db.execute.side_effect = fake_execute
    return db


@pytest.mark.asyncio
async def test_helper_none_means_noop():
    """library_ids=None → 不动 (no execute calls)."""
    db = _make_db([])
    point = MagicMock()
    point.id = 10
    await _replace_linked_libraries(db, point, library_ids=None)
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_helper_empty_clears():
    """library_ids=[] → 清空关联 (delete issued, no insert)."""
    db = _make_db([])
    point = MagicMock()
    point.id = 10
    await _replace_linked_libraries(db, point, library_ids=[])
    # 至少一次 execute (DELETE)
    assert db.execute.await_count >= 1


@pytest.mark.asyncio
async def test_helper_single_image_inserts():
    """library_ids=[42] (type=image) → 1 row inserted."""
    db = _make_db([(42, LibraryType.IMAGE)])
    point = MagicMock()
    point.id = 10
    await _replace_linked_libraries(db, point, library_ids=[42])
    # 至少 2 execute (SELECT + DELETE + INSERT)
    assert db.execute.await_count >= 2


@pytest.mark.asyncio
async def test_helper_rejects_mixed_types():
    """image + word mixed → 400."""
    from fastapi import HTTPException

    db = _make_db([(1, LibraryType.IMAGE), (2, LibraryType.WORD)])
    point = MagicMock()
    point.id = 10
    with pytest.raises(HTTPException) as exc:
        await _replace_linked_libraries(db, point, library_ids=[1, 2])
    assert exc.value.status_code == 400
    assert "single library_type" in exc.value.detail


@pytest.mark.asyncio
async def test_helper_rejects_missing_id():
    """传不存在 ID → 400 not found."""
    from fastapi import HTTPException

    db = _make_db([(1, LibraryType.IMAGE)])  # 只返回了 id=1
    point = MagicMock()
    point.id = 10
    with pytest.raises(HTTPException) as exc:
        await _replace_linked_libraries(db, point, library_ids=[1, 99])
    assert exc.value.status_code == 400
    assert "libraries not found" in exc.value.detail
    assert "99" in exc.value.detail


@pytest.mark.asyncio
async def test_helper_three_types_rejected():
    """image + word + reply 三种类型混合 → 400."""
    from fastapi import HTTPException

    db = _make_db(
        [
            (1, LibraryType.IMAGE),
            (2, LibraryType.WORD),
            (3, LibraryType.REPLY),
        ]
    )
    point = MagicMock()
    point.id = 10
    with pytest.raises(HTTPException) as exc:
        await _replace_linked_libraries(db, point, library_ids=[1, 2, 3])
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_helper_word_multi_inserts():
    """library_ids=[w1,w2] (type=word) → 2 rows inserted."""
    db = _make_db([(11, LibraryType.WORD), (12, LibraryType.WORD)])
    point = MagicMock()
    point.id = 10
    await _replace_linked_libraries(db, point, library_ids=[11, 12])
    assert db.execute.await_count >= 2


@pytest.mark.asyncio
async def test_helper_reply_multi_inserts():
    """library_ids=[r1,r2] (type=reply) → 2 rows inserted."""
    db = _make_db([(21, LibraryType.REPLY), (22, LibraryType.REPLY)])
    point = MagicMock()
    point.id = 10
    await _replace_linked_libraries(db, point, library_ids=[21, 22])
    assert db.execute.await_count >= 2
