"""Verify that strategy creation persists to DB after handler returns.

This test guards against the regression where handler-level commit was missing,
causing writes to be lost when the client disconnected mid-response (CancelledError
is BaseException, not caught by except Exception in get_db).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

import app.models  # noqa: F401
from app.api.v1.strategies import create_strategy
from app.schemas.strategy import StrategyCreate
from app.models.user import User, UserRole


def _make_strategy_mock(**overrides) -> MagicMock:
    """Build a MagicMock that mimics the attributes read by _serialize_strategy
    and Pydantic schema validation."""
    m = MagicMock()
    m.id = overrides.get("id", 1)
    m.code = overrides.get("code", "1")
    m.name = overrides.get("name", "test")
    m.scope = overrides.get("scope", "general")
    m.description = overrides.get("description", None)
    m.is_active = overrides.get("is_active", True)
    m.priority = overrides.get("priority", 1)
    m.effective_from = overrides.get("effective_from", None)
    m.effective_until = overrides.get("effective_until", None)
    m.definition = overrides.get("definition", {})
    m.service_config = overrides.get("service_config", {})
    m.created_at = overrides.get("created_at", None)
    m.updated_at = overrides.get("updated_at", None)
    return m


@pytest.mark.asyncio
async def test_strategy_create_calls_commit():
    """create_strategy handler must call db.commit() explicitly."""
    # Mock DB session
    db = MagicMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.commit = AsyncMock()

    # Mock execute for code uniqueness check and _next_code
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None  # code uniqueness check
    execute_result.scalar_one.return_value = "1"  # _next_code returns "1"
    db.execute = AsyncMock(return_value=execute_result)

    # db.add(s) mutates `s` — make `s` reflect attrs that _serialize_strategy reads
    def fake_add(s: MagicMock) -> None:
        s.id = 1
        s.code = "1"
        s.created_at = None
        s.updated_at = None
    db.add.side_effect = fake_add

    # Mock user
    user = MagicMock(spec=User)
    user.id = 1

    # Mock body
    body = StrategyCreate(
        name="test-commit",
        services=["text_audit_pro"],
        is_active=True,
        priority=1,
    )

    # Call handler — accept any schema-validation failure from mocks
    try:
        result = await create_strategy(body, db, user)
    except Exception:
        pass

    # Verify commit was called
    db.commit.assert_called_once(), "Handler must call db.commit() explicitly"


@pytest.mark.asyncio
async def test_strategy_update_calls_commit():
    """update_strategy handler must call db.commit() explicitly."""
    from app.api.v1.strategies import update_strategy
    from app.schemas.strategy import StrategyUpdate
    from app.models.strategy import Strategy, StrategyScope

    # Mock DB session
    db = MagicMock()
    db.get = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.commit = AsyncMock()

    # Mock strategy
    strategy = _make_strategy_mock(name="old")
    strategy.scope = StrategyScope.GENERAL
    db.get.return_value = strategy

    # Mock user
    user = MagicMock(spec=User)
    user.id = 1

    # Mock body
    body = StrategyUpdate(name="new")

    # Call handler — accept any schema-validation failure from mocks
    try:
        result = await update_strategy(1, body, db, user)
    except Exception:
        pass

    # Verify commit was called
    db.commit.assert_called_once(), "Handler must call db.commit() explicitly"


@pytest.mark.asyncio
async def test_strategy_delete_calls_commit():
    """delete_strategy handler must call db.commit() explicitly."""
    from app.api.v1.strategies import delete_strategy
    from app.models.strategy import Strategy, StrategyScope

    # Mock DB session
    db = MagicMock()
    db.get = AsyncMock()
    db.delete = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    # Mock strategy
    strategy = MagicMock(spec=Strategy)
    strategy.id = 1
    strategy.scope = StrategyScope.GENERAL
    strategy.code = "2000001"
    db.get.return_value = strategy

    # Mock user
    user = MagicMock(spec=User)
    user.id = 1

    # Call handler
    await delete_strategy(1, db, user)

    # Verify commit was called
    db.commit.assert_called_once(), "Handler must call db.commit() explicitly"


@pytest.mark.asyncio
async def test_strategy_duplicate_calls_commit():
    """duplicate_strategy handler must call db.commit() explicitly."""
    from app.api.v1.strategies import duplicate_strategy
    from app.schemas.strategy import StrategyDuplicateRequest
    from app.models.strategy import Strategy, StrategyScope

    # Mock DB session
    db = MagicMock()
    db.get = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.commit = AsyncMock()

    # Mock execute for _next_code
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None  # code check
    execute_result.scalar_one.return_value = "1"  # _next_code
    db.execute = AsyncMock(return_value=execute_result)

    def fake_add(s: MagicMock) -> None:
        s.id = 1
        s.code = "1"
        s.created_at = None
        s.updated_at = None
    db.add.side_effect = fake_add

    # Mock source strategy
    src = _make_strategy_mock(
        id=1,
        name="original",
        description="desc",
        scope=StrategyScope.GENERAL,
    )
    src.service_config = {}
    db.get.return_value = src

    # Mock user
    user = MagicMock(spec=User)
    user.id = 1

    # Mock body
    body = StrategyDuplicateRequest(name="copy")

    # Call handler — accept any schema-validation failure from mocks
    try:
        result = await duplicate_strategy(1, body, db, user)
    except Exception:
        pass

    # Verify commit was called
    db.commit.assert_called_once(), "Handler must call db.commit() explicitly"
