"""Tag service — CRUD only."""
from __future__ import annotations

from typing import List, Optional, Tuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag, TagSource, TagStatus
from app.schemas.tag import TagCreate, TagUpdate


class TagValidationError(ValueError):
    """Raised when a tag payload fails validation."""


async def list_tags(
    db: AsyncSession,
    *,
    page: int,
    size: int,
    domain: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[TagStatus] = None,
    source: Optional[str] = None,
    jurisdictions: Optional[List[str]] = None,
    industries: Optional[List[str]] = None,
    channels: Optional[List[str]] = None,
    q: Optional[str] = None,
) -> Tuple[List[Tag], int]:
    stmt = select(Tag)
    conds = []
    if domain:
        conds.append(Tag.domain == domain)
    if category:
        conds.append(Tag.category == category)
    if status:
        conds.append(Tag.status == status)
    if source:
        conds.append(Tag.source == source)
    if q:
        conds.append(or_(Tag.name.ilike(f"%{q}%"), Tag.code.ilike(f"%{q}%")))
    if conds:
        stmt = stmt.where(and_(*conds))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = (
        stmt.order_by(Tag.updated_at.desc().nullslast(), Tag.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    rows = (await db.execute(stmt)).scalars().unique().all()

    # P0: filter JSONB-backed dimension lists in Python after the SQL page.
    if jurisdictions:
        rows = [
            t for t in rows if not t.jurisdictions or set(t.jurisdictions).intersection(jurisdictions)
        ]
    if industries:
        rows = [
            t for t in rows if not t.industries or set(t.industries).intersection(industries)
        ]
    if channels:
        rows = [
            t for t in rows if not t.channels or set(t.channels).intersection(channels)
        ]
    return list(rows), int(total)


async def get_tag(db: AsyncSession, tag_id: str) -> Optional[Tag]:
    return await db.get(Tag, tag_id)


async def get_tag_by_code(db: AsyncSession, code: str) -> Optional[Tag]:
    return (await db.execute(select(Tag).where(Tag.code == code))).scalars().first()


async def create_tag(db: AsyncSession, body: TagCreate) -> Tag:
    existing = await get_tag_by_code(db, body.code)
    if existing:
        raise TagValidationError(f"code 已存在: {body.code}")
    tag = Tag(
        code=body.code,
        name=body.name,
        name_en=body.name_en,
        description=body.description,
        domain=body.domain,
        category=body.category,
        jurisdictions=body.jurisdictions,
        industries=body.industries,
        channels=body.channels,
        knowledge_refs=body.knowledge_refs,
        evidence_refs=body.evidence_refs,
        source=body.source,
        status=body.status,
        version=1,
    )
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    return tag


async def update_tag(db: AsyncSession, tag: Tag, body: TagUpdate) -> Tag:
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(tag, k, v)
    tag.version = (tag.version or 1) + 1
    await db.flush()
    await db.refresh(tag)
    return tag


async def delete_tag(db: AsyncSession, tag: Tag) -> None:
    await db.delete(tag)
    await db.flush()