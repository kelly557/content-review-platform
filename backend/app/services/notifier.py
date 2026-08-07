"""Notification channels for AlertEvent.

Implements a thin protocol with two built-in channels:

* ``WebhookChannel`` — POSTs JSON to one or more URLs. Signs DingTalk requests
  with the optional ``secret`` env config so the same URL list works for
  DingTalk / Feishu / WeCom / generic JSON.  Plain (no secret) URLs receive
  the body as-is.

* ``EmailChannel`` — Optional SMTP fallback. Skipped if SMTP env is not set.

The dispatcher iterates over registered channels; one channel failure does
not stop the others. A small in-process retry (3 attempts, exponential backoff)
covers transient network errors.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
import urllib.parse
from dataclasses import dataclass
from typing import Iterable, List, Protocol

from app.core.config import settings

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Channel protocol
# ---------------------------------------------------------------------------


class NotificationChannel(Protocol):
    name: str

    async def send(self, alert_payload: dict) -> bool: ...


# ---------------------------------------------------------------------------
# Webhook (DingTalk / Feishu / WeCom / generic)
# ---------------------------------------------------------------------------


def _sign_dingtalk(secret: str) -> tuple[int, str]:
    """Compute DingTalk HMAC-SHA256 signature for the given secret.

    Returns ``(timestamp, sign)``. The sign string is the URL-encoded
    value of ``base64(HMAC_SHA256(secret, f"{ts}\n{secret}"))``.
    """
    ts = int(round(time.time() * 1000))
    string_to_sign = f"{ts}\n{secret}"
    digest = hmac.new(
        secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256
    ).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(digest))
    return ts, sign


@dataclass
class WebhookChannel:
    name: str = "webhook"
    urls: List[str] = None  # type: ignore[assignment]
    secrets: List[str] = None  # type: ignore[assignment]
    timeout: float = 5.0

    def __post_init__(self) -> None:
        self.urls = self.urls or []
        self.secrets = self.secrets or []
        if not self.urls:
            log.info("WebhookChannel: no URLs configured, channel is a no-op")

    async def send(self, alert_payload: dict) -> bool:
        if not self.urls:
            return True  # nothing to do counts as success
        body = json.dumps(alert_payload, ensure_ascii=False, default=str)
        any_ok = False
        for idx, url in enumerate(self.urls):
            target = url
            secret = self.secrets[idx] if idx < len(self.secrets) else ""
            if secret and "access_token=" in url:
                ts, sign = _sign_dingtalk(secret)
                sep = "&" if "?" in url else "?"
                target = f"{url}{sep}timestamp={ts}&sign={sign}"
            ok = await self._post_with_retry(target, body)
            any_ok = any_ok or ok
        return any_ok

    async def _post_with_retry(self, url: str, body: str) -> bool:
        try:
            import httpx  # local import; only needed if webhooks are configured
        except ImportError:  # pragma: no cover - dev convenience
            log.warning("httpx not installed; webhook notifications disabled")
            return False
        delays = (0.5, 1.5)
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.post(
                        url,
                        content=body,
                        headers={"Content-Type": "application/json"},
                    )
                if 200 <= resp.status_code < 300:
                    return True
                log.warning(
                    "webhook %s responded %s: %s",
                    url,
                    resp.status_code,
                    resp.text[:200],
                )
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                log.warning("webhook %s attempt %d failed: %r", url, attempt + 1, exc)
            if attempt < 2:
                await asyncio.sleep(delays[attempt])
        if last_exc:
            log.error("webhook %s permanently failed: %r", url, last_exc)
        return False


# ---------------------------------------------------------------------------
# Email (SMTP) — optional
# ---------------------------------------------------------------------------


@dataclass
class EmailChannel:
    name: str = "email"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = ""
    mail_to: List[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.mail_to = self.mail_to or []

    async def send(self, alert_payload: dict) -> bool:
        if not (self.smtp_host and self.smtp_user and self.mail_to):
            return True  # not configured → no-op success
        try:
            import aiosmtplib
            from email.message import EmailMessage
        except ImportError:  # pragma: no cover
            log.warning("aiosmtplib not installed; email notifications disabled")
            return False
        msg = EmailMessage()
        msg["Subject"] = f"[AdReview Alert] {alert_payload.get('rule_code', 'event')}"
        msg["From"] = self.mail_from or self.smtp_user
        msg["To"] = ", ".join(self.mail_to)
        msg.set_content(json.dumps(alert_payload, indent=2, ensure_ascii=False, default=str))
        try:
            await aiosmtplib.send(
                msg,
                hostname=self.smtp_host,
                port=self.smtp_port,
                username=self.smtp_user,
                password=self.smtp_password,
                start_tls=True,
            )
            return True
        except Exception as exc:  # noqa: BLE001
            log.exception("email send failed: %r", exc)
            return False


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def _split(value: str) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def build_default_channels() -> List[NotificationChannel]:
    """Build channels from environment variables.

    Env:
        ``ALERT_WEBHOOK_URLS``      — comma-separated webhook URLs
        ``ALERT_WEBHOOK_SECRETS``   — comma-separated secrets (1:1 with URLs)
        ``ALERT_NOTIFY_EMAILS``     — comma-separated recipients
        ``SMTP_HOST`` ``SMTP_PORT`` ``SMTP_USER`` ``SMTP_PASSWORD``
        ``SMTP_FROM``
    """
    channels: List[NotificationChannel] = []
    urls = _split(getattr(settings, "alert_webhook_urls", ""))
    secrets = _split(getattr(settings, "alert_webhook_secrets", ""))
    if urls:
        channels.append(WebhookChannel(urls=urls, secrets=secrets))

    recipients = _split(getattr(settings, "alert_notify_emails", ""))
    smtp_host = getattr(settings, "smtp_host", "")
    if recipients and smtp_host:
        channels.append(
            EmailChannel(
                smtp_host=smtp_host,
                smtp_port=int(getattr(settings, "smtp_port", 587) or 587),
                smtp_user=getattr(settings, "smtp_user", ""),
                smtp_password=getattr(settings, "smtp_password", ""),
                mail_from=getattr(settings, "smtp_from", ""),
                mail_to=recipients,
            )
        )
    return channels


def alert_to_payload(alert) -> dict:
    """Convert an AlertEvent ORM instance into a JSON-safe dict for delivery."""
    return {
        "id": alert.id,
        "rule_code": alert.rule_code,
        "severity": alert.severity,
        "metric": alert.metric,
        "window_start": alert.window_start.isoformat() if alert.window_start else None,
        "window_end": alert.window_end.isoformat() if alert.window_end else None,
        "observed_value": alert.observed_value,
        "threshold": alert.threshold,
        "dimension": alert.dimension or {},
        "detail": alert.detail or {},
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


async def dispatch(alert, channels: Iterable[NotificationChannel]) -> bool:
    """Send ``alert`` to all channels. Returns True if any channel succeeded."""
    payload = alert_to_payload(alert)
    tasks = [ch.send(payload) for ch in channels]
    if not tasks:
        return False
    results = await asyncio.gather(*tasks, return_exceptions=True)
    ok = False
    for ch, res in zip(channels, results):
        if isinstance(res, Exception):
            log.warning("channel %s raised: %r", getattr(ch, "name", "?"), res)
        else:
            ok = ok or res
    return ok
