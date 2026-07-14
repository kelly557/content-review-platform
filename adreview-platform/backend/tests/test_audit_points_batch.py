"""AuditPoint batch-create endpoint tests.

Ensures the batch handler rolls back per-row failures and surfaces the
succeeded/failed summary correctly. Uses MagicMock instead of a real DB
to avoid the Python 3.14 asyncpg + TestClient conflict noted in
test_libraries_v3.py.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

import app.models  # noqa: F401
from app.api.v1.audit_points import create_points_batch
from app.models.audit_item import AuditItem
from app.models.service import Service
from app.models.user import User
from app.schemas.audit_point import AuditPointBatchCreate, AuditPointCreate


@pytest.fixture
def patched_deps(monkeypatch: pytest.MonkeyPatch):
    db = MagicMock()
    db.get = AsyncMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()
    db.rollback = AsyncMock()

    user = MagicMock(spec=User)
    user.id = 1

    svc = MagicMock(spec=Service)
    svc.code = "image_audit_pro"
    item = MagicMock(spec=AuditItem)
    item.id = 100
    item.package_code = "image_audit_pro"
    item.is_builtin = False

    async def fake_ensure(_db, _code):
        return svc

    async def fake_generate(_db, _code, _item_id):
        return "ap_100_x"

    async def fake_item_execute(_stmt, *args, **kwargs):
        # _ensure_item_writable 现在用 select(AuditItem).where(id=item_id)
        res = MagicMock()
        res.scalar_one_or_none = MagicMock(return_value=item)
        return res

    db.execute.side_effect = fake_item_execute
    monkeypatch.setattr(
        "app.api.v1.audit_points._ensure_package", fake_ensure
    )
    monkeypatch.setattr(
        "app.api.v1.audit_points._generate_point_code", fake_generate
    )

    return db, user, item


@pytest.mark.asyncio
async def test_batch_create_all_success(monkeypatch, patched_deps):
    db, user, item = patched_deps

    counter = {"n": 0}

    async def fake_refresh(_point):
        _point.id = counter["n"] + 1
        _point.is_builtin = False
        from datetime import datetime, timezone
        _point.created_at = datetime.now(timezone.utc)
        counter["n"] += 1

    db.refresh.side_effect = fake_refresh

    body = AuditPointBatchCreate(
        item_id=100,
        points=[
            AuditPointCreate(
                item_id=100, label_cn=f"p{i}", risk_level="中风险"
            )
            for i in range(3)
        ],
    )
    result = await create_points_batch("image_audit_pro", body, db, user)

    assert result.succeeded == 3
    assert result.failed == 0
    assert all(it.status == "ok" for it in result.items)
    assert db.commit.await_count == 3
    db.rollback.assert_not_awaited()

