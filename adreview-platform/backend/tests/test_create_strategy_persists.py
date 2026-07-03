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


@pytest.mark.asyncio
async def test_strategy_create_calls_commit():
    """create_strategy handler must call db.commit() explicitly."""
    # Mock DB session
    db = MagicMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    # Mock execute for code uniqueness check and _next_code
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None  # code uniqueness check
    execute_result.scalar_one.return_value = "1"  # _next_code returns "1"
    db.execute = AsyncMock(return_value=execute_result)

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

    # Call handler
    result = await create_strategy(body, db, user)

    # Verify commit was called
    db.commit.assert_called_once(), "Handler must call db.commit() explicitly"
    assert result.name == "test-commit"


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
    strategy = MagicMock(spec=Strategy)
    strategy.id = 1
    strategy.scope = StrategyScope.GENERAL
    strategy.name = "old"
    db.get.return_value = strategy

    # Mock user
    user = MagicMock(spec=User)
    user.id = 1

    # Mock body
    body = StrategyUpdate(name="new")

    # Call handler
    result = await update_strategy(1, body, db, user)

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
    db.commit = AsyncMock()

    # Mock execute for _next_code
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None  # code check
    execute_result.scalar_one.return_value = "1"  # _next_code
    db.execute = AsyncMock(return_value=execute_result)

    # Mock source strategy
    src = MagicMock(spec=Strategy)
    src.id = 1
    src.scope = StrategyScope.GENERAL
    src.name = "original"
    src.description = "desc"
    src.priority = 1
    src.effective_from = None
    src.effective_until = None
    src.definition = {}
    db.get.return_value = src

    # Mock user
    user = MagicMock(spec=User)
    user.id = 1

    # Mock body
    body = StrategyDuplicateRequest(name="copy")

    # Call handler
    result = await duplicate_strategy(1, body, db, user)

    # Verify commit was called
    db.commit.assert_called_once(), "Handler must call db.commit() explicitly"
