"""Inbound webhook endpoint for external review model callbacks.

Validates (in order):
  1. IP allowlist (fail-closed).
  2. HMAC-SHA256 signature over (X-Timestamp + raw_body) using the
     trigger's secret_alias (resolved from env vars).
  3. X-Timestamp within 5 minutes of server clock (replay protection).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.trigger import Trigger, TriggerType
from app.services import ip_allowlist
from app.services.trigger_engine import handle_callback

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


REPLAY_WINDOW_SECONDS = 300


def _resolve_secret(alias: str) -> str | None:
    name = f"WEBHOOK_SECRET_{alias.upper()}"
    return os.environ.get(name)


def _verify_signature(raw_body: bytes, signature: str, timestamp: str, secret: str) -> bool:
    if not signature or not signature.startswith("sha256="):
        return False
    msg = timestamp.encode() + raw_body
    expected = "sha256=" + hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _verify_timestamp(timestamp: str) -> bool:
    try:
        ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    delta = abs((datetime.now(timezone.utc) - ts).total_seconds())
    return delta <= REPLAY_WINDOW_SECONDS


@router.post("/callback/{trigger_code}")
async def webhook_callback(
    trigger_code: str,
    request: Request,
    x_signature: str | None = Header(default=None, alias="X-Signature"),
    x_timestamp: str | None = Header(default=None, alias="X-Timestamp"),
):
    """External model callback endpoint."""
    # 1. IP allowlist
    client_ip = request.client.host if request.client else None
    if not ip_allowlist.is_allowed(client_ip):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="IP not in allowlist"
        )

    raw_body = await request.body()

    # 2. Lookup trigger
    db_gen = get_db()
    db: AsyncSession = await db_gen.__anext__()
    try:
        trigger = await db.scalar(
            select(Trigger).where(Trigger.code == trigger_code)
        )
        if trigger is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="trigger not found"
            )
        if trigger.trigger_type != TriggerType.EXTERNAL_CALLBACK.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="trigger is not a callback trigger",
            )
        if not trigger.is_enabled:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="trigger is disabled"
            )

        # 3. Replay protection
        if not x_timestamp or not _verify_timestamp(x_timestamp):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired timestamp"
            )

        # 4. Signature
        secret_alias = (trigger.spec or {}).get("secret_alias") or "primary"
        secret = _resolve_secret(secret_alias)
        if not secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"webhook secret not configured for alias '{secret_alias}'",
            )
        if not _verify_signature(raw_body, x_signature or "", x_timestamp, secret):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid signature"
            )

        # 5. Parse + dispatch
        try:
            payload = json.loads(raw_body.decode())
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"invalid JSON body: {exc}",
            ) from exc

        # Close the request-level session before opening a new one in
        # the handler (to avoid session overlap).
        await db_gen.aclose()
        result = await handle_callback(trigger, payload)
        if not result.get("received"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result.get("reason", "callback rejected"),
            )
        return result
    finally:
        try:
            await db_gen.aclose()
        except Exception:  # pragma: no cover
            pass