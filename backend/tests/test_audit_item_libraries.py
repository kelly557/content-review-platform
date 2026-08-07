"""AuditItem ↔ Library N:M tests (关联自定义图库词库上移至审核项)。

Covers:
1. Schema / route registration on AuditItem side
2. ORM model wiring (AuditItemLibrary table, relationships)
3. _replace_item_linked_libraries helper logic (validation + idempotency)
4. PATCH semantics (None / [] / [ids])
5. Inter-type rejection (互斥校验)
6. Builtin item 允许 linking (linked_library_ids 在白名单内)
7. Legacy audit_point_libraries 表与 join column 仍存在，不被 router 写入
"""
from __future__ import annotations

from typing import Optional
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.models  # noqa: F401
from app.api.v1.audit_items import _replace_item_linked_libraries
from app.main import app
from app.models.audit_item_library import AuditItemLibrary
from app.models.audit_point_library import AuditPointLibrary
from app.models.library import Library, LibraryType


# ────────────────────────────────────────────────────────────────────
# 1. Schema / route registration
# ────────────────────────────────────────────────────────────────────


def test_audit_item_out_has_linked_libraries():
    schemas = app.openapi()["components"]["schemas"]
    assert "AuditItemOut" in schemas
    props = schemas["AuditItemOut"]["properties"]
    assert "linked_libraries" in props
    assert props["linked_libraries"]["type"] == "array"


def test_audit_item_create_has_linked_library_ids():
    schemas = app.openapi()["components"]["schemas"]
    assert "AuditItemCreate" in schemas
    props = schemas["AuditItemCreate"]["properties"]
    assert "linked_library_ids" in props


def test_audit_item_update_has_linked_library_ids():
    schemas = app.openapi()["components"]["schemas"]
    assert "AuditItemUpdate" in schemas
    props = schemas["AuditItemUpdate"]["properties"]
    assert "linked_library_ids" in props


def test_linked_library_out_schema():
    schemas = app.openapi()["components"]["schemas"]
    assert "LinkedLibraryOut" in schemas
    props = schemas["LinkedLibraryOut"]["properties"]
    for f in ("library_id", "library_type", "code", "name"):
        assert f in props, f"missing LinkedLibraryOut.{f}"


def test_audit_point_no_longer_exposes_linked_libraries():
    """审核点不再对外暴露 linked_libraries / linked_library_ids。"""
    schemas = app.openapi()["components"]["schemas"]
    assert "AuditPointOut" in schemas
    props = schemas["AuditPointOut"]["properties"]
    assert "linked_libraries" not in props
    assert "AuditPointCreate" in schemas
    cp_props = schemas["AuditPointCreate"]["properties"]
    assert "linked_library_ids" not in cp_props
    assert "AuditPointUpdate" in schemas
    up_props = schemas["AuditPointUpdate"]["properties"]
    assert "linked_library_ids" not in up_props


def test_strategy_point_ref_drops_linked_library_ids():
    """策略级 override 也下线 linked_library_ids。"""
    schemas = app.openapi()["components"]["schemas"]
    assert "StrategyPointRef" in schemas
    props = schemas["StrategyPointRef"]["properties"]
    assert "linked_library_ids" not in props


def test_strategy_out_exposes_llm_review_field():
    """大模型审核总开关 + 选定模型暴露为单一字段（不按媒体类型拆分）。"""
    schemas = app.openapi()["components"]["schemas"]
    assert "StrategyOut" in schemas
    props = schemas["StrategyOut"]["properties"]
    assert "llm_review" in props
    # LlmReviewConfig 是一个 $ref 对象，而非 dict。
    assert "$ref" in props["llm_review"]


def test_strategy_create_llm_review_field():
    schemas = app.openapi()["components"]["schemas"]
    assert "StrategyCreate" in schemas
    props = schemas["StrategyCreate"]["properties"]
    assert "llm_review" in props


def test_llm_review_config_exposes_multimodal_hint():
    """LlmReviewConfig 必须暴露 needs_multimodal_hint 用于前端多模态提示。"""
    schemas = app.openapi()["components"]["schemas"]
    assert "LlmReviewConfig" in schemas
    props = schemas["LlmReviewConfig"]["properties"]
    for f in ("is_enabled", "model_id", "needs_multimodal_hint"):
        assert f in props, f"missing LlmReviewConfig.{f}"


# ────────────────────────────────────────────────────────────────────
# 2. ORM model wiring
# ────────────────────────────────────────────────────────────────────


def test_audit_item_library_table_columns():
    cols = {c.name for c in AuditItemLibrary.__table__.columns}
    for col in ("audit_item_id", "library_id", "sort_order", "created_at"):
        assert col in cols, f"missing column: {col}"


def test_audit_item_library_primary_key():
    pk_cols = {c.name for c in AuditItemLibrary.__table__.primary_key.columns}
    assert pk_cols == {"audit_item_id", "library_id"}


def test_audit_item_relationships_present():
    from app.models.audit_item import AuditItem

    rels = {r.key for r in AuditItem.__mapper__.relationships}
    assert "linked_libraries" in rels
    assert "linked_library_links" in rels


def test_library_back_audit_items_relationship():
    rels = {r.key for r in Library.__mapper__.relationships}
    assert "back_audit_items" in rels


def test_audit_point_library_table_legacy_kept():
    """旧 audit_point_libraries 表保留（不被 router 写入）。"""
    cols = {c.name for c in AuditPointLibrary.__table__.columns}
    for col in ("audit_point_id", "library_id", "sort_order", "created_at"):
        assert col in cols


# ────────────────────────────────────────────────────────────────────
# 3. _replace_item_linked_libraries helper logic
# ────────────────────────────────────────────────────────────────────


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
        result = MagicMock()
        result.all = MagicMock(return_value=library_rows)
        return result

    db.execute.side_effect = fake_execute
    return db


@pytest.mark.asyncio
async def test_helper_none_means_noop():
    """library_ids=None → 不动 (no execute calls)."""
    db = _make_db([])
    item = MagicMock()
    item.id = 10
    await _replace_item_linked_libraries(db, item, library_ids=None)
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_helper_empty_clears():
    """library_ids=[] → 清空关联 (delete issued, no insert)."""
    db = _make_db([])
    item = MagicMock()
    item.id = 10
    await _replace_item_linked_libraries(db, item, library_ids=[])
    assert db.execute.await_count >= 1


@pytest.mark.asyncio
async def test_helper_single_image_inserts():
    """library_ids=[42] (type=image) → 1 row inserted."""
    db = _make_db([(42, LibraryType.IMAGE)])
    item = MagicMock()
    item.id = 10
    await _replace_item_linked_libraries(db, item, library_ids=[42])
    assert db.execute.await_count >= 2


@pytest.mark.asyncio
async def test_helper_rejects_mixed_types():
    """image + word mixed → 400."""
    from fastapi import HTTPException

    db = _make_db([(1, LibraryType.IMAGE), (2, LibraryType.WORD)])
    item = MagicMock()
    item.id = 10
    with pytest.raises(HTTPException) as exc:
        await _replace_item_linked_libraries(db, item, library_ids=[1, 2])
    assert exc.value.status_code == 400
    assert "single library_type" in exc.value.detail


@pytest.mark.asyncio
async def test_helper_rejects_missing_id():
    """传不存在 ID → 400 not found."""
    from fastapi import HTTPException

    db = _make_db([(1, LibraryType.IMAGE)])  # 只返回了 id=1
    item = MagicMock()
    item.id = 10
    with pytest.raises(HTTPException) as exc:
        await _replace_item_linked_libraries(db, item, library_ids=[1, 99])
    assert exc.value.status_code == 400
    assert "libraries not found" in exc.value.detail
    assert "99" in exc.value.detail
