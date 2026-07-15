"""Tests for POST /api/v1/reviews/tasks/auto and /ingest/publish."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401
from app.core.security import create_access_token
from app.models.material import Material, MaterialStatus, MaterialType, MaterialVersion
from app.models.user import User, UserRole
from app.models.workflow import WorkflowTemplate


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


def _auth_headers(user: User) -> dict:
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_auto_create_tasks_requires_auth(client: AsyncClient):
    resp = await client.post("/api/v1/reviews/tasks/auto", json={"material_ids": [1]})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_auto_create_tasks_validation_empty_ids(client: AsyncClient, db_session: AsyncSession):
    admin = await _get_admin(db_session)
    resp = await client.post(
        "/api/v1/reviews/tasks/auto",
        headers=_auth_headers(admin),
        json={"material_ids": []},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_auto_create_tasks_happy_path(
    client: AsyncClient, db_session: AsyncSession
):
    await _seed_template(db_session)
    admin = await _get_admin(db_session)

    async def _make(title: str, status: MaterialStatus) -> Material:
        m = Material(
            title=title, material_type=MaterialType.TEXT, status=status,
            submitter_id=admin.id,
        )
        db_session.add(m)
        await db_session.flush()
        v = MaterialVersion(
            material_id=m.id, version_no=1, storage_key="k",
            original_filename="t.txt", mime_type="text/plain", file_size=1,
            created_by_id=admin.id,
        )
        db_session.add(v)
        await db_session.flush()
        m.current_version_id = v.id
        await db_session.commit()
        await db_session.refresh(m)
        return m

    m1 = await _make("m1", MaterialStatus.DRAFT)
    m2 = await _make("m2", MaterialStatus.SUBMITTED)

    resp = await client.post(
        "/api/v1/reviews/tasks/auto",
        headers=_auth_headers(admin),
        json={"material_ids": [m1.id, m2.id]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["requested"] == 2
    assert body["created"] == 2
    assert len(body["workflow_instance_ids"]) == 2


@pytest.mark.asyncio
async def test_auto_create_tasks_reports_missing_ids(
    client: AsyncClient, db_session: AsyncSession
):
    await _seed_template(db_session)
    admin = await _get_admin(db_session)
    resp = await client.post(
        "/api/v1/reviews/tasks/auto",
        headers=_auth_headers(admin),
        json={"material_ids": [99999]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 0
    assert body["skipped"] == 1
    assert body["errors"][0]["material_id"] == 99999


@pytest.mark.asyncio
async def test_ingest_publish_returns_503_when_mq_disabled(
    client: AsyncClient, db_session: AsyncSession
):
    """mq_consumer_enabled defaults to False in test env; endpoint must 503."""
    admin = await _get_admin(db_session)
    resp = await client.post(
        "/api/v1/reviews/ingest/publish",
        headers=_auth_headers(admin),
        json={"material_ids": [1]},
    )
    assert resp.status_code == 503