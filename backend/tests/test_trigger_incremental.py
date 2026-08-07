"""Tests for trigger incremental-scope filter in _query_materials."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401
from app.models.material import Material, MaterialStatus, MaterialType, MaterialVersion
from app.models.trigger import Trigger
from app.models.user import User, UserRole
from app.services.trigger_engine import _query_materials


async def _seed_material(
    db: AsyncSession,
    submitter: User,
    *,
    status: MaterialStatus = MaterialStatus.DRAFT,
    updated_at: datetime | None = None,
    title: str = "t",
) -> Material:
    m = Material(
        title=title,
        material_type=MaterialType.TEXT,
        status=status,
        submitter_id=submitter.id,
    )
    db.add(m)
    await db.flush()
    v = MaterialVersion(
        material_id=m.id,
        version_no=1,
        storage_key="k",
        original_filename="t.txt",
        mime_type="text/plain",
        file_size=1,
        created_by_id=submitter.id,
    )
    db.add(v)
    await db.flush()
    m.current_version_id = v.id
    if updated_at is not None:
        m.updated_at = updated_at
    await db.commit()
    await db.refresh(m)
    return m


async def _seed_admin(db: AsyncSession) -> User:
    from app.core.security import hash_password

    admin = User(
        email="test-admin-inc@adreview.example.com",
        full_name="Test Admin Inc",
        hashed_password=hash_password("test"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    return admin


@pytest.mark.asyncio
async def test_full_scope_returns_all_candidates(db_session: AsyncSession):
    admin = await _seed_admin(db_session)
    a = await _seed_material(db_session, admin, title="a")
    b = await _seed_material(db_session, admin, title="b")

    trigger = Trigger(spec={}, last_run_at=None)
    rows = await _query_materials(db_session, trigger, batch_size=100)
    ids = {r.id for r in rows}
    assert a.id in ids
    assert b.id in ids


@pytest.mark.asyncio
async def test_incremental_scope_filters_by_last_run_at(db_session: AsyncSession):
    admin = await _seed_admin(db_session)

    now = datetime.now(timezone.utc)
    old = await _seed_material(
        db_session, admin, title="old",
        updated_at=now - timedelta(hours=2),
    )
    fresh = await _seed_material(
        db_session, admin, title="fresh",
        updated_at=now - timedelta(minutes=5),
    )

    trigger = Trigger(
        spec={"scope": "incremental"},
        last_run_at=now - timedelta(hours=1),
    )
    rows = await _query_materials(db_session, trigger, batch_size=100)
    ids = {r.id for r in rows}
    assert fresh.id in ids
    assert old.id not in ids


@pytest.mark.asyncio
async def test_incremental_without_last_run_returns_all(db_session: AsyncSession):
    """First-ever run: incremental mode with no last_run_at must NOT skip."""
    admin = await _seed_admin(db_session)
    a = await _seed_material(db_session, admin, title="a")

    trigger = Trigger(spec={"scope": "incremental"}, last_run_at=None)
    rows = await _query_materials(db_session, trigger, batch_size=100)
    ids = {r.id for r in rows}
    assert a.id in ids


@pytest.mark.asyncio
async def test_full_scope_ignores_updated_at(db_session: AsyncSession):
    """Default scope must not filter on last_run_at even if it is set."""
    admin = await _seed_admin(db_session)
    now = datetime.now(timezone.utc)
    old = await _seed_material(
        db_session, admin, title="old",
        updated_at=now - timedelta(days=30),
    )

    trigger = Trigger(spec={}, last_run_at=now - timedelta(hours=1))
    rows = await _query_materials(db_session, trigger, batch_size=100)
    ids = {r.id for r in rows}
    assert old.id in ids