"""OpsLog — operational audit trail for privileged/risky actions.

Records events that operators may want to inspect later to answer
"who ran what when". Today we log:

- script invocations: ``seed.py`` (with / without the bypass tokens),
  ``init_db.py``, ``migrate_*`` migrations, ``check_no_seed_ref.sh``.

Each row carries:
- ``actor``: who triggered it (``"manual"`` for local shells, ``"ci:<host>"``
  when called from a future CI runner, etc.).
- ``action``: dotted path (e.g., ``"scripts.seed.run"``).
- ``status``: ``"started" | "succeeded" | "refused" | "failed"``.
- ``detail``: free-form JSON payload (arguments, env overrides, reason).
- ``argv``/``cwd``: how it was invoked.
- ``created_at``: server-side timestamp.

Schema-level guarantees:
- Read-only via the application ORM (no public mutation endpoint).
- Inserts are fire-and-forget; failures here never block the script.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.core.id_generator import new_public_id


class OpsLog(Base):
    __tablename__ = "ops_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    actor: Mapped[str] = mapped_column(String(64), nullable=False, default="manual")
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    argv: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cwd: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    detail: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    __table_args__ = (
        Index("ix_ops_log_action_created_at", "action", "created_at"),
    )
