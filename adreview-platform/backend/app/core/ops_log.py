"""Helper to write ops_log entries from standalone CLI scripts.

Standalone scripts (e.g., ``scripts/seed.py``, ``scripts/init_db.py``,
``scripts/migrate_*.py``) cannot reach the FastAPI app's request logging.
This module provides a safe, narrow entrypoint that:

- Inserts a single row into ``public.ops_log`` capturing the script
  name, action, status, argv/cwd.
- Never raises: a database failure during audit-write must NOT abort
  the running script. We log to stderr and move on.

NOTE: This module does NOT do anything to enforce safety. It only
records what happened. The actual safety gates live in each script.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import sys
from typing import Any, Optional


def record_op(
    action: str,
    status: str,
    *,
    detail: Optional[dict[str, Any]] = None,
    message: Optional[str] = None,
    actor: Optional[str] = None,
    argv: Optional[str] = None,
    cwd: Optional[str] = None,
) -> None:
    """Insert one ops_log row. Best-effort: failures are logged, not raised."""
    try:
        # Lazy imports so this module can be loaded from scripts without
        # forcing the entire FastAPI app to boot.
        from app.core.config import settings as _settings
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from app.models.ops_log import OpsLog  # noqa: F401  ensures registration

        # Reuse the sync engine that scripts/seed.py and init_db.py use.
        dsn = getattr(_settings, "database_url_sync", None) or _settings.database_url
        if dsn.startswith("postgresql+asyncpg://"):
            dsn_sync = dsn.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        elif dsn.startswith("postgresql+psycopg2://"):
            dsn_sync = dsn
        else:
            return  # sqlite tests / unknown dialect: silently skip

        eng = create_engine(dsn_sync, isolation_level="AUTOCOMMIT")
        with Session(eng) as s:
            s.add(
                OpsLog(
                    actor=actor or os.environ.get("OPS_ACTOR") or _default_actor(),
                    action=action,
                    status=status,
                    argv=argv or " ".join(sys.argv),
                    cwd=cwd or os.getcwd(),
                    detail=_coerce_detail(detail),
                    message=message,
                )
            )
            s.commit()
    except Exception as exc:  # pragma: no cover — never abort the script
        logging.getLogger("adreview.ops_log").warning(
            "ops_log write failed for action=%s status=%s: %r", action, status, exc
        )


def _default_actor() -> str:
    if os.environ.get("CI"):
        host = os.environ.get("CI_RUNNER_HOSTNAME") or os.environ.get("HOSTNAME", "ci")
        return f"ci:{host}"
    try:
        return f"manual:{os.getlogin()}"
    except OSError:
        return f"manual:{socket.gethostname()}"


def _coerce_detail(d: Optional[dict[str, Any]]) -> Optional[Any]:
    if d is None:
        return None
    try:
        return json.loads(json.dumps(d, default=str))
    except Exception:
        return None
