"""Persist LlmCall audit rows (best-effort; never raises back to the caller)."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm_call import LlmCall


async def record_llm_call(
    db: AsyncSession | None,
    *,
    task_id: Optional[int],
    version_id: Optional[int],
    correlation_id: Optional[str],
    ok: bool,
    schema_valid: bool,
    truncated: bool,
    input_chars: Optional[int],
    token_in: Optional[int],
    token_out: Optional[int],
    latency_ms: Optional[int],
    error: Optional[str],
    model: Optional[str],
) -> None:
    """Insert one LlmCall row. No-op when ``db`` is None (unit tests)."""
    if db is None:
        return
    row = LlmCall(
        task_id=task_id,
        version_id=version_id,
        correlation_id=correlation_id,
        model=model,
        ok=ok,
        schema_valid=schema_valid,
        truncated=truncated,
        input_chars=input_chars,
        token_in=token_in,
        token_out=token_out,
        latency_ms=latency_ms,
        error=error,
    )
    db.add(row)
    await db.flush()
