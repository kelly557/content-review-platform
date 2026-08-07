"""Health check endpoints — used for DB connectivity probes.

GET /health            : app-level (always available)
GET /api/v1/health/db  : DB connectivity check (probes PostgreSQL)
"""
import time

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.session import get_db

log = get_logger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/db")
async def db_health(db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    """Probe PostgreSQL connectivity by issuing a single `SELECT 1`.

    Returns 200 even on failure — the JSON body conveys status. Frontend reads
    /health/db every 30s and surfaces a red banner when ``ok`` is False.
    """
    started = time.monotonic()
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover
        log.error(f"db_health check failed: {exc!r}")
        return {
            "ok": False,
            "error": str(exc),
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
    return {
        "ok": True,
        "latency_ms": int((time.monotonic() - started) * 1000),
    }
