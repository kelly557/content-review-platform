"""Material router: CRUD, upload, list, retrieve."""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.material import Material, MaterialStatus, MaterialType, MaterialVersion
from app.models.user import User
from app.schemas.common import Page
from app.schemas.material import (
    MaterialCreate,
    MaterialListItem,
    MaterialOut,
    MaterialSubmitRequest,
    MaterialUpdate,
    MaterialVersionOut,
)
from app.services import audit, storage
from app.services.workflow_engine import get_template_by_code, start_instance

router = APIRouter(prefix="/materials", tags=["materials"])


@router.get("", response_model=Page[MaterialListItem])
async def list_materials(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    status_filter: MaterialStatus | None = Query(default=None, alias="status"),
    material_type: MaterialType | None = None,
    q: str | None = None,
    mine: bool = False,
) -> Page[MaterialListItem]:
    stmt = select(Material)
    conditions = []
    if mine:
        conditions.append(Material.submitter_id == user.id)
    if status_filter:
        conditions.append(Material.status == status_filter)
    if material_type:
        conditions.append(Material.material_type == material_type)
    if q:
        conditions.append(or_(Material.title.ilike(f"%{q}%"), Material.description.ilike(f"%{q}%")))
    if conditions:
        stmt = stmt.where(and_(*conditions))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    stmt = stmt.order_by(Material.updated_at.desc()).offset((page - 1) * size).limit(size)
    result = await db.execute(stmt)
    items = [MaterialListItem.model_validate(m) for m in result.scalars()]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
async def create_material(
    body: MaterialCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Material:
    material = Material(
        title=body.title,
        description=body.description,
        material_type=body.material_type,
        tags=body.tags or {},
        extra_metadata=body.extra_metadata or {},
        submitter_id=user.id,
    )
    db.add(material)
    await db.flush()
    await audit.write_audit(
        db, actor=user, action="material.create",
        entity_type="material", entity_id=material.id,
        payload={"type": body.material_type.value},
    )
    await db.commit()
    # Re-query to ensure all fields are loaded for response serialization
    material = await db.scalar(
        select(Material)
        .where(Material.id == material.id)
        .options(selectinload(Material.versions))
    )
    return material


@router.get("/{material_id}", response_model=MaterialOut)
async def get_material(
    material_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Material:
    result = await db.execute(
        select(Material)
        .where(Material.id == material_id)
        .options(selectinload(Material.versions))
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="material not found")
    return material


@router.patch("/{material_id}", response_model=MaterialOut)
async def update_material(
    material_id: int,
    body: MaterialUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Material:
    material = await db.scalar(
        select(Material)
        .where(Material.id == material_id)
        .options(selectinload(Material.versions))
    )
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="material not found")
    if material.submitter_id != user.id and user.role.value != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your material")
    if body.title is not None:
        material.title = body.title
    if body.description is not None:
        material.description = body.description
    if body.tags is not None:
        material.tags = body.tags
    if body.extra_metadata is not None:
        material.extra_metadata = body.extra_metadata
    await db.flush()
    await db.commit()
    # Re-query to ensure all fields are loaded for response serialization
    material = await db.scalar(
        select(Material)
        .where(Material.id == material_id)
        .options(selectinload(Material.versions))
    )
    return material


@router.post(
    "/{material_id}/versions",
    response_model=MaterialVersionOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_version(
    material_id: int,
    file: UploadFile = File(...),
    text_body: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MaterialVersionOut:
    material = await db.get(Material, material_id)
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="material not found")
    if material.submitter_id != user.id and user.role.value != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your material")

    if file.content_type and file.content_type not in settings.storage_allowed_mime:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"mime {file.content_type} not allowed",
        )

    next_version_no = 1
    if material.current_version_id:
        current = await db.get(MaterialVersion, material.current_version_id)
        if current:
            next_version_no = current.version_no + 1

    key, size, sha = storage.save_upload(
        material.id, next_version_no, file.filename or "upload.bin", file.file
    )
    version = MaterialVersion(
        material_id=material.id,
        version_no=next_version_no,
        storage_key=key,
        original_filename=file.filename or "upload.bin",
        mime_type=file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream",
        file_size=size,
        checksum=sha,
        text_body=text_body,
        created_by_id=user.id,
    )
    db.add(version)
    await db.flush()
    material.current_version_id = version.id
    if material.status == MaterialStatus.REJECTED:
        material.status = MaterialStatus.DRAFT
    await audit.write_audit(
        db, actor=user, action="material.version.upload",
        entity_type="material", entity_id=material.id,
        payload={"version_id": version.id, "size": size},
    )
    await db.commit()
    return _version_to_out(version)


@router.get("/{material_id}/versions/{version_id}/download")
async def download_version(
    material_id: int,
    version_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    version = await db.get(MaterialVersion, version_id)
    if not version or version.material_id != material_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="version not found")
    stream = storage.open_stream(version.storage_key)
    return StreamingResponse(
        stream,
        media_type=version.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{version.original_filename}"'},
    )


@router.post("/{material_id}/submit", response_model=MaterialOut)
async def submit_material(
    material_id: int,
    body: MaterialSubmitRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Material:
    material = await db.get(Material, material_id)
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="material not found")
    if material.submitter_id != user.id and user.role.value != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not your material")
    if not material.current_version_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no version to submit")
    if material.status not in (MaterialStatus.DRAFT, MaterialStatus.REJECTED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"cannot submit from status {material.status.value}"
        )

    template = None
    template_code = "hybrid"
    template = await get_template_by_code(db, template_code)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"unknown workflow template: {template_code}",
        )
    await start_instance(db, material, template, user)
    await db.commit()
    # Re-query to ensure all fields are loaded for response serialization
    material = await db.scalar(
        select(Material)
        .where(Material.id == material_id)
        .options(selectinload(Material.versions))
    )
    return material


def _version_to_out(v: MaterialVersion) -> MaterialVersionOut:
    out = MaterialVersionOut.model_validate(v)
    out.download_url = f"/api/v1/materials/{v.material_id}/versions/{v.id}/download"
    return out
