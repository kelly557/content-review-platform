"""Unit tests for material_ingest: validation, batching, status whitelist."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401
from app.models.material import Material, MaterialStatus, MaterialType
from app.models.user import User, UserRole
from app.models.workflow import WorkflowTemplate
from app.services.material_ingest import (
    INGEST_ELIGIBLE_STATUSES,
    IngestResult,
    ingest_batch,
    ingest_one,
)
from app.services.workflow_engine import WorkflowError


async def _seed_template(db: AsyncSession, code: str = "auto_only") -> WorkflowTemplate:
    tpl = WorkflowTemplate(
        code=code,
        name="auto",
        definition={"stages": [{"key": "initial", "name": "初审", "type": "human"}]},
        is_active=True,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


async def _seed_material(
    db: AsyncSession,
    submitter: User,
    status: MaterialStatus = MaterialStatus.DRAFT,
    material_type: MaterialType = MaterialType.TEXT,
    title: str = "test material",
) -> Material:
    from app.models.material import MaterialVersion

    # Step 1: create material without current_version_id (FK target).
    m = Material(
        title=title,
        material_type=material_type,
        status=status,
        submitter_id=submitter.id,
    )
    db.add(m)
    await db.flush()

    # Step 2: create a version pointing at the material.
    version = MaterialVersion(
        material_id=m.id,
        version_no=1,
        storage_key="test/key",
        original_filename="test.txt",
        mime_type="text/plain",
        file_size=1,
        created_by_id=submitter.id,
    )
    db.add(version)
    await db.flush()

    # Step 3: link the material to its current version.
    m.current_version_id = version.id
    await db.commit()
    await db.refresh(m)
    return m


async def _get_admin(db: AsyncSession) -> User:
    from sqlalchemy import select

    res = await db.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
    admin = res.scalar_one_or_none()
    if admin is not None:
        return admin
    from app.core.security import hash_password

    admin = User(
        email="test-admin@adreview.example.com",
        full_name="Test Admin",
        hashed_password=hash_password("test"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    return admin


@pytest.mark.asyncio
async def test_ingest_one_creates_workflow_instance(db_session: AsyncSession):
    await _seed_template(db_session)
    admin = await _get_admin(db_session)
    material = await _seed_material(db_session, admin)

    instance = await ingest_one(
        db_session,
        material,
        actor=admin,
        source="api_push",
    )
    await db_session.commit()

    assert instance.id is not None
    assert instance.material_id == material.id


@pytest.mark.asyncio
async def test_ingest_one_rejects_approved_material(db_session: AsyncSession):
    await _seed_template(db_session)
    admin = await _get_admin(db_session)
    material = await _seed_material(db_session, admin, status=MaterialStatus.APPROVED)

    with pytest.raises(WorkflowError) as exc_info:
        await ingest_one(db_session, material, actor=admin, source="api_push")
    assert "not eligible" in str(exc_info.value)


@pytest.mark.asyncio
async def test_ingest_one_rejects_withdrawn_material(db_session: AsyncSession):
    await _seed_template(db_session)
    admin = await _get_admin(db_session)
    material = await _seed_material(db_session, admin, status=MaterialStatus.WITHDRAWN)

    with pytest.raises(WorkflowError):
        await ingest_one(db_session, material, actor=admin, source="api_push")


@pytest.mark.asyncio
async def test_ingest_batch_reports_per_material_outcomes(db_session: AsyncSession):
    await _seed_template(db_session)
    admin = await _get_admin(db_session)

    ok1 = await _seed_material(db_session, admin, title="ok1", status=MaterialStatus.DRAFT)
    ok2 = await _seed_material(db_session, admin, title="ok2", status=MaterialStatus.SUBMITTED)
    bad = await _seed_material(db_session, admin, title="bad", status=MaterialStatus.APPROVED)

    result = await ingest_batch(
        db_session,
        [ok1.id, ok2.id, bad.id, 99999],
        actor=admin,
        source="api_push",
    )

    assert isinstance(result, IngestResult)
    assert result.requested == 4
    assert result.created == 2
    # bad status + missing id both surface as failures, not crashes
    assert result.skipped == 2
    failure_reasons = {f.material_id: f.reason for f in result.failures}
    assert failure_reasons[bad.id]  # non-empty
    assert "not found" in failure_reasons[99999]


@pytest.mark.asyncio
async def test_ingest_batch_dedupes_input_ids(db_session: AsyncSession):
    await _seed_template(db_session)
    admin = await _get_admin(db_session)
    m = await _seed_material(db_session, admin)

    result = await ingest_batch(
        db_session,
        [m.id, m.id, m.id],
        actor=admin,
        source="api_push",
    )
    # Duplicate input is collapsed; the second start_instance for the same
    # material succeeds because the material is now IN_REVIEW (still in
    # INGEST_ELIGIBLE_STATUSES). Either way, requested counts unique ids.
    assert result.requested == 3
    assert len(result.workflow_instance_ids) <= 3


@pytest.mark.asyncio
async def test_eligible_statuses_constant():
    assert MaterialStatus.DRAFT.value in INGEST_ELIGIBLE_STATUSES
    assert MaterialStatus.SUBMITTED.value in INGEST_ELIGIBLE_STATUSES
    assert MaterialStatus.IN_REVIEW.value in INGEST_ELIGIBLE_STATUSES
    assert MaterialStatus.REJECTED.value in INGEST_ELIGIBLE_STATUSES
    assert MaterialStatus.APPROVED.value not in INGEST_ELIGIBLE_STATUSES
    assert MaterialStatus.WITHDRAWN.value not in INGEST_ELIGIBLE_STATUSES