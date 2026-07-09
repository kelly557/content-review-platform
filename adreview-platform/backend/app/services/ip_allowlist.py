"""IP allowlist for webhook ingress.

Holds an in-memory cache of enabled CIDRs loaded from the DB. Refresh
on startup and on every CRUD operation. Empty cache = reject all
(fail-closed).
"""
from __future__ import annotations

import ipaddress
import threading
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.trigger import WebhookIpAllowlist

log = get_logger(__name__)

_lock = threading.RLock()
_networks_cache: list[ipaddress._BaseNetwork] = []


def _parse_networks(rows: Iterable[WebhookIpAllowlist]) -> list[ipaddress._BaseNetwork]:
    nets: list[ipaddress._BaseNetwork] = []
    for r in rows:
        try:
            nets.append(ipaddress.ip_network(r.cidr, strict=False))
        except ValueError as exc:
            log.warning("ip_allowlist: bad CIDR %r (%s) — skipping", r.cidr, exc)
    return nets


async def refresh(db: AsyncSession) -> None:
    """Reload enabled CIDRs from DB into memory."""
    result = await db.execute(
        select(WebhookIpAllowlist).where(WebhookIpAllowlist.is_enabled.is_(True))
    )
    nets = _parse_networks(result.scalars().all())
    with _lock:
        _networks_cache.clear()
        _networks_cache.extend(nets)
    log.info("ip_allowlist: loaded %d networks", len(nets))


def is_allowed(client_ip: Optional[str]) -> bool:
    """Return True iff client_ip is in any enabled CIDR.

    Empty cache → reject all.
    """
    if not client_ip:
        return False
    try:
        ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    with _lock:
        nets = list(_networks_cache)
    if not nets:
        return False
    return any(ip in net for net in nets)


def validate_cidr(cidr: str) -> str:
    """Raise ValueError on invalid CIDR; return canonical form."""
    net = ipaddress.ip_network(cidr, strict=False)
    return str(net)