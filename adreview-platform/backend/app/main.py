"""FastAPI application entry."""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import __version__
from app.api.v1 import api_router
from app.core.config import settings
from app.core.logging import get_logger, setup_logging
from app.db.session import Base, engine
from app.tasks.background import shutdown as shutdown_tasks

log = get_logger(__name__)


async def _ensure_analytics_tables() -> None:
    """Create only the analytics-specific tables (alert_events) if missing.

    This is intentionally idempotent and non-destructive: we never drop data.
    Production deployments should use Alembic; this helper exists so the
    scaffold can pick up the new analytics tables on the next restart.
    """
    try:
        from app.models import alert_event  # noqa: F401 — register on Base.metadata
    except Exception as exc:  # pragma: no cover
        log.warning("startup: could not import alert_event model: %r", exc)
        return
    target = Base.metadata.tables.get("alert_events")
    if target is None:
        return
    try:
        async with engine.begin() as conn:

            def _create(connection) -> None:
                Base.metadata.create_all(
                    connection, tables=[target], checkfirst=True
                )

            await conn.run_sync(_create)
        log.info("startup: ensured analytics tables (alert_events)")
    except Exception as exc:  # pragma: no cover
        log.warning("startup: could not ensure analytics tables: %r", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    # Startup probe: verify DB connectivity. Failure does NOT block startup —
    # we log loudly so operators notice, and the frontend banner picks it up
    # at the first /health/db poll.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        log.info("startup: DB connectivity OK")
    except Exception as exc:
        log.error(f"startup: DB connectivity FAILED: {exc!r}")

    # Make sure analytics tables exist (alert_events) without dropping data.
    await _ensure_analytics_tables()

    # Anomaly scanner: best-effort; if it crashes we keep serving API.
    scanner_stop = asyncio.Event()
    scanner_task: asyncio.Task | None = None
    if getattr(settings, "alert_scanner_enabled", True):
        from app.services.anomaly_scanner import run_loop as scanner_run_loop

        scanner_task = asyncio.create_task(scanner_run_loop(scanner_stop), name="anomaly_scanner")

    # Trigger cron loop (always on — list is empty until admin creates triggers).
    from app.services.trigger_engine import run_cron_loop as trigger_run_loop

    trigger_stop = asyncio.Event()
    trigger_task = asyncio.create_task(trigger_run_loop(trigger_stop), name="trigger_cron")

    try:
        yield
    finally:
        if scanner_task is not None:
            scanner_stop.set()
            scanner_task.cancel()
            try:
                await scanner_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        trigger_stop.set()
        trigger_task.cancel()
        try:
            await trigger_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        await shutdown_tasks()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        debug=settings.app_debug,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "app": settings.app_name, "version": __version__}

    app.include_router(api_router)
    return app


app = create_app()
