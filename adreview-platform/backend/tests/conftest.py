"""Shared pytest fixtures for API tests.

Uses PostgreSQL with a per-test temporary schema so we don't pollute the
public schema. SQLite is not viable here because some models use raw JSONB.
"""
from __future__ import annotations

import os

import pytest_asyncio
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Default to the local dev DB; override via env if needed.
DEFAULT_DSN = "postgresql+asyncpg://adreview:adreview@localhost:5432/adreview"

import app.models  # noqa: F401  -- ensure all models register on Base.metadata
from app.core.security import hash_password
from app.db.session import Base, get_db
from app.main import app
from app.models.user import User, UserRole


def _make_test_schema_name() -> str:
    import uuid

    return f"test_{uuid.uuid4().hex[:12]}"


def _apply_schema(schema: str | None) -> None:
    """Stamp the schema on every table and column. When None, reset to default."""
    for table in Base.metadata.tables.values():
        table.schema = schema
        for column in table.columns:
            # 重新绑定 column -> table，让 SQLAlchemy 在 compile 时拿到最新 schema。
            column.table = table


@pytest_asyncio.fixture
async def db_engine():
    dsn = os.environ.get("DATABASE_URL", DEFAULT_DSN)
    schema = _make_test_schema_name()
    sync_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")
    sync_engine = create_engine(sync_dsn, isolation_level="AUTOCOMMIT")
    with sync_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    sync_engine.dispose()

    # 关键：每次测试都新建一个 NullPool 的 engine，避免连接池复用导致 cached statement 残留
    # 上一个测试的 search_path。
    engine = create_async_engine(
        dsn,
        connect_args={"server_settings": {"search_path": schema}},
        poolclass=NullPool,
    )
    _apply_schema(schema)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()
        # Drop the temporary schema.
        sync_engine = create_engine(sync_dsn, isolation_level="AUTOCOMMIT")
        with sync_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        sync_engine.dispose()
        # Reset schema assignment so other tests don't leak it.
        _apply_schema(None)


@pytest_asyncio.fixture
async def db_session_factory(db_engine):
    return async_sessionmaker(
        bind=db_engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )


@pytest_asyncio.fixture
async def db_session(db_session_factory):
    async with db_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session_factory):
    """An httpx AsyncClient with the app's ``get_db`` overridden to use the
    per-test schema and pre-populated with default seed users.
    """

    async def _override_get_db():
        async with db_session_factory() as session:
            try:
                yield session
            finally:
                if session.in_transaction():
                    await session.rollback()

    app.dependency_overrides[get_db] = _override_get_db

    async with db_session_factory() as session:
        seed_users = [
            User(
                email="admin@adreview.example.com",
                full_name="Admin",
                hashed_password=hash_password(
                    "change-me-in-production-please-admin"
                ),
                role=UserRole.ADMIN,
                is_active=True,
            ),
            User(
                email="superadmin@adreview.example.com",
                full_name="Superadmin",
                hashed_password=hash_password("superadmin123"),
                role=UserRole.SUPERADMIN,
                is_active=True,
            ),
            User(
                email="mlr@adreview.example.com",
                full_name="MLR",
                hashed_password=hash_password("mlr12345"),
                role=UserRole.MLR,
                is_active=True,
            ),
            User(
                email="reviewer@adreview.example.com",
                full_name="Reviewer",
                hashed_password=hash_password("reviewer123"),
                role=UserRole.REVIEWER,
                is_active=True,
            ),
            User(
                email="submitter@adreview.example.com",
                full_name="Submitter",
                hashed_password=hash_password("submitter123"),
                role=UserRole.SUBMITTER,
                is_active=True,
            ),
        ]
        for u in seed_users:
            session.add(u)
        await session.commit()

    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()