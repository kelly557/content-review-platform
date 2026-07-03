"""Async SQLAlchemy engine + session."""
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    settings.database_url,
    echo=settings.app_debug,
    pool_pre_ping=True,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Per-request session.

    Handlers MUST call ``await session.commit()`` themselves after writes.
    This dependency only handles rollback on error and a defensive rollback
    in ``finally`` if the handler forgot to commit (prevents open-tx leaks).

    Note: ``asyncio.CancelledError`` is a ``BaseException`` (not caught by
    ``except Exception``), so the previous "commit on clean yield-exit" pattern
    silently dropped writes whenever the client disconnected mid-response.
    Making commits explicit at the handler level fixes that.
    """
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            if session.in_transaction():
                await session.rollback()
