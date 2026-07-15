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
    """Stamp the schema on every table and column. When None, reset to default.

    SQLAlchemy 2 的 ORM 层通过 cache_key 跟踪 schema。column.table 重新绑定
    后需要重新设置 column._cache_key_traversal，否则会沿用上一个测试的
    编译表达式（包含旧 schema 名）。
    """
    for table in Base.metadata.tables.values():
        table.schema = schema
        for column in table.columns:
            column.table = table
            # 清 column 自身的 annotations cache 和 compiler dispatch，
            # 强制下次访问时重新生成绑定 schema 名的表达式
            try:
                for attr in ("__annotations_cache__", "_compile_w_cache"):
                    if hasattr(column, attr):
                        v = getattr(column, attr, None)
                        if v and hasattr(v, "clear"):
                            v.clear()
                        elif isinstance(v, dict):
                            v.clear()
            except Exception:
                pass
    # 同时清掉 ORM mapper 的全局 compile cache
    try:
        from sqlalchemy.orm import mapper as _mapper_mod

        for m in _mapper_mod.Mapper.registry.mappers:
            cache = getattr(m, "_compiled_cache", None)
            if cache is not None and hasattr(cache, "clear"):
                cache.clear()
            # mapper 上每个 ColumnProperty 也可能持有 cache
            for prop in m.attrs.values():
                for attr in ("_cache_key_traversal", "__annotations_cache__"):
                    v = getattr(prop, attr, None)
                    if isinstance(v, dict) and hasattr(v, "clear"):
                        v.clear()
    except Exception:
        pass


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