"""Material router: CRUD, upload, list, retrieve."""
from __future__ import annotations

import mimetypes
import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
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
    MaterialBatchUploadItem,
    MaterialBatchUploadResponse,
    MaterialCreate,
    MaterialListItem,
    MaterialOut,
    MaterialSubmitRequest,
    MaterialUpdate,
    MaterialVersionOut,
)
from app.services import audit, storage
from app.services.upload_inference import (
    MAX_BATCH_FILES,
    infer_material_type,
    infer_mime_from_filename,
    infer_title,
)
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
    background_tasks: BackgroundTasks,
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
    await start_instance(db, material, template, user, task_name=body.task_name, skip_machine_review=body.skip_machine_review)
    await db.commit()

    # FastAPI-safe scheduling of the machine review. `asyncio.create_task` inside
    # the workflow engine fires before the response is sent, but Starlette can
    # drop it when the handler returns, so the review never actually runs.
    # BackgroundTasks runs after the response is sent to the client, guaranteeing
    # the AI scan executes. The route layer only schedules if this is the first
    # machine stage (skip_machine_review=False is already checked in start_instance).
    if not body.skip_machine_review:
        from app.models.review import ReviewTask as _RT, MachineStatus as _MS
        from sqlalchemy import select as _sa_select
        rt = await db.scalar(
            _sa_select(_RT).where(_RT.material_id == material_id).order_by(_RT.id.desc()).limit(1)
        )
        if rt and rt.machine_status == _MS.PENDING:
            from app.services.workflow_engine import _run_machine_review_async
            background_tasks.add_task(_run_machine_review_async, rt.id, None)

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


@router.post(
    "/uploads",
    response_model=MaterialBatchUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def batch_upload_materials(
    files: list[UploadFile] = File(..., description=f"1..{MAX_BATCH_FILES} files"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MaterialBatchUploadResponse:
    """Upload 1..N files in one request.

    Each file becomes a new Material + MaterialVersion (v1). Mime/extension are
    used to infer ``material_type``; title defaults to the filename stem.
    Per-file failures (mime not allowed, oversize, storage error, db error)
    are recorded in ``items[].error`` without blocking the rest.
    """
    if user.role.value not in {"submitter", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only submitter/admin can upload materials",
        )
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no files provided")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"max {MAX_BATCH_FILES} files per batch",
        )

    items: list[MaterialBatchUploadItem] = []
    succeeded = 0
    failed = 0

    for index, file in enumerate(files):
        filename = file.filename or ""
        mime = (file.content_type or "").lower() or None
        item_result: MaterialBatchUploadItem
        try:
            if mime and mime not in settings.storage_allowed_mime:
                raise HTTPException(
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    detail=f"mime {mime} not allowed",
                )

            material_type = infer_material_type(mime, filename)
            if material_type is None:
                guessed = infer_mime_from_filename(filename)
                if guessed:
                    mime = guessed
                    if mime not in settings.storage_allowed_mime:
                        raise HTTPException(
                            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            detail=f"mime {mime} not allowed",
                        )
                    material_type = infer_material_type(mime, filename)
            if material_type is None:
                raise HTTPException(
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    detail=f"unsupported type for file {filename or 'upload.bin'}",
                )

            # Save file to storage first (no DB dependency). If this fails we
            # have not touched the DB yet, so nothing to roll back.
            try:
                key, size, sha = storage.save_upload(
                    -1, 1, filename or "upload.bin", file.file
                )
            except storage.StorageError as exc:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)
                )

            # Each file gets its own outer transaction: commit on success,
            # rollback on failure. Committing closes the transaction so the
            # next iteration starts fresh.
            try:
                material = Material(
                    title=infer_title(filename, index + 1),
                    material_type=material_type,
                    tags={},
                    extra_metadata={},
                    submitter_id=user.id,
                )
                db.add(material)
                await db.flush()

                # Move the file from the placeholder key to the real key.
                real_key = storage._safe_key(material.id, 1, filename or "upload.bin")
                real_path = settings.storage_root / "uploads" / real_key
                real_path.parent.mkdir(parents=True, exist_ok=True)
                src_path = settings.storage_root / "uploads" / key
                if src_path != real_path:
                    shutil.move(str(src_path), str(real_path))
                key = real_key

                version = MaterialVersion(
                    material_id=material.id,
                    version_no=1,
                    storage_key=key,
                    original_filename=filename or "upload.bin",
                    mime_type=mime or mimetypes.guess_type(filename or "")[0] or "application/octet-stream",
                    file_size=size,
                    checksum=sha,
                    created_by_id=user.id,
                )
                db.add(version)
                await db.flush()
                material.current_version_id = version.id

                await audit.write_audit(
                    db, actor=user, action="material.create",
                    entity_type="material", entity_id=material.id,
                    payload={"type": material_type.value, "via": "batch_upload"},
                )
                await audit.write_audit(
                    db, actor=user, action="material.version.upload",
                    entity_type="material", entity_id=material.id,
                    payload={"version_id": version.id, "size": size},
                )

                await db.commit()

                material = await db.scalar(
                    select(Material)
                    .where(Material.id == material.id)
                    .options(selectinload(Material.versions))
                )
                item_result = MaterialBatchUploadItem(
                    index=index,
                    ok=True,
                    filename=filename or None,
                    material=MaterialOut.model_validate(material),
                )
                succeeded += 1
            except Exception:
                if db.in_transaction():
                    await db.rollback()
                # Best-effort cleanup of the on-disk file for this item.
                try:
                    storage.delete_object(key)
                except Exception:  # noqa: BLE001
                    pass
                raise
        except HTTPException as exc:
            item_result = MaterialBatchUploadItem(
                index=index,
                ok=False,
                filename=filename or None,
                error=str(exc.detail),
            )
            failed += 1
        except Exception as exc:  # noqa: BLE001
            item_result = MaterialBatchUploadItem(
                index=index,
                ok=False,
                filename=filename or None,
                error=f"db_error: {exc.__class__.__name__}",
            )
            failed += 1
        items.append(item_result)

    return MaterialBatchUploadResponse(
        total=len(files),
        succeeded=succeeded,
        failed=failed,
        items=items,
    )
