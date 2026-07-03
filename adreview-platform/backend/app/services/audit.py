"""Audit log writer."""
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent
from app.models.user import User


async def write_audit(
    db: AsyncSession,
    *,
    actor: Optional[User],
    action: str,
    entity_type: str,
    entity_id: int,
    payload: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_id=actor.id if actor else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload or {},
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(event)
    return event
