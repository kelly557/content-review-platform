"""Annotation router: per-version comments + pin geometry."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.annotation import Annotation
from app.models.material import MaterialVersion
from app.models.user import User
from app.schemas.common import Page
from app.schemas.review import AnnotationCreate, AnnotationOut
from app.services import audit

router = APIRouter(prefix="/annotations", tags=["annotations"])


@router.get("", response_model=Page[AnnotationOut])
async def list_annotations(
    version_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
) -> Page[AnnotationOut]:
    base = select(Annotation).where(Annotation.material_version_id == version_id)
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    result = await db.execute(
        base.order_by(Annotation.created_at.asc()).offset((page - 1) * size).limit(size)
    )
    items = [AnnotationOut.model_validate(a) for a in result.scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=AnnotationOut, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    body: AnnotationCreate,
    version_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationOut:
    version = await db.get(MaterialVersion, version_id)
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="version not found")
    ann = Annotation(
        material_version_id=version_id,
        author_id=user.id,
        page=body.page,
        frame=body.frame,
        timestamp_ms=body.timestamp_ms,
        x=body.x,
        y=body.y,
        w=body.w,
        h=body.h,
        shape=body.shape,
        quote=body.quote,
        body=body.body,
        parent_id=body.parent_id,
    )
    db.add(ann)
    await db.flush()
    await audit.write_audit(
        db, actor=user, action="annotation.create",
        entity_type="material_version", entity_id=version_id,
        payload={"annotation_id": ann.id},
    )
    await db.commit()
    return AnnotationOut.model_validate(ann)


@router.patch("/{annotation_id}/resolve", response_model=AnnotationOut)
async def resolve_annotation(
    annotation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnnotationOut:
    ann = await db.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="annotation not found")
    ann.resolved = not ann.resolved
    await db.flush()
    await db.commit()
    return AnnotationOut.model_validate(ann)
