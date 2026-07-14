"""Knowledge document API — file management with versioning.

Independent from /libraries. Phase-1 scope: file management + version history.
No extraction/import workflows; no policy-only fields. The library is the
content-safety review team's authoritative reference material (laws,
regulations, internal SOPs, platform rules, white papers, etc.).
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.session import get_db
from app.models.knowledge_document import (
    KnowledgeDocument,
    KnowledgeDocumentSourceType,
    KnowledgeDocumentStatus,
    KnowledgeDocumentVersion,
)
from app.models.user import User
from app.schemas.common import Page
from app.schemas.knowledge_document import (
    KnowledgeDocumentCreate,
    KnowledgeDocumentListItem,
    KnowledgeDocumentOut,
    KnowledgeDocumentUpdate,
    KnowledgeDocumentVersionOut,
)
from app.services import storage
from app.services.audit import write_audit
from app.services.code_generator import generate_knowledge_document_code
from app.services.resource_auth import require_reader, require_writer

router = APIRouter(prefix="/knowledge-documents", tags=["knowledge-documents"])

ALLOWED_MIME = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXT = {".pdf", ".txt", ".md", ".doc", ".docx"}
MAX_BYTES = 20 * 1024 * 1024
ALLOWED_STATUS = {s.value for s in KnowledgeDocumentStatus}
ALLOWED_SOURCE_TYPES = {t.value for t in KnowledgeDocumentSourceType}


def _to_out(doc: KnowledgeDocument) -> KnowledgeDocumentOut:
    current = None
    cv = doc.current_version if doc.current_version_id else None
    if cv is not None:
        try:
            current = KnowledgeDocumentVersionOut.model_validate(cv)
        except Exception:
            current = None
    payload = {
        "id": doc.id,
        "public_id": doc.public_id,
        "code": doc.code,
        "title": doc.title,
        "description": doc.description,
        "tags": list(doc.tags or []),
        "issued_at": doc.issued_at,
        "status": doc.status,
        "source_type": doc.source_type,
        "source_url": doc.source_url,
        "current_version_id": doc.current_version_id,
        "current_version": current,
        "owner_id": doc.owner_id,
        "created_by_id": doc.created_by_id,
        "updated_by_id": doc.updated_by_id,
        "is_deleted": doc.is_deleted,
        "deleted_at": doc.deleted_at,
        "created_at": doc.created_at,
        "updated_at": doc.updated_at,
    }
    return KnowledgeDocumentOut.model_validate(payload)


def _to_list_item(doc: KnowledgeDocument) -> KnowledgeDocumentListItem:
    current = None
    if doc.current_version:
        try:
            current = KnowledgeDocumentVersionOut.model_validate(doc.current_version)
        except Exception:
            current = None
    payload = {
        "id": doc.id,
        "public_id": doc.public_id,
        "code": doc.code,
        "title": doc.title,
        "tags": list(doc.tags or []),
        "source_type": doc.source_type,
        "issued_at": doc.issued_at,
        "status": doc.status,
        "current_version_id": doc.current_version_id,
        "current_version_no": current.version_no if current else None,
        "current_version": current,
        "owner_id": doc.owner_id,
        "updated_at": doc.updated_at,
        "created_at": doc.created_at,
    }
    return KnowledgeDocumentListItem.model_validate(payload)


def _validate_status(s: str | None) -> str | None:
    if s is None:
        return None
    if s not in ALLOWED_STATUS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法 status: {s}")
    return s


def _validate_source_type(s: str) -> str:
    if s not in ALLOWED_SOURCE_TYPES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"非法来源方式: {s}（期望 upload / url / manual）",
        )
    return s


def _normalize_tags(values: list[str] | None) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        v = raw.strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


async def _next_version_no(db: AsyncSession, document_id: int) -> int:
    result = await db.scalar(
        select(func.coalesce(func.max(KnowledgeDocumentVersion.version_no), 0)).where(
            KnowledgeDocumentVersion.document_id == document_id
        )
    )
    return int(result or 0) + 1


async def _store_upload(
    db: AsyncSession, doc: KnowledgeDocument, file: UploadFile
) -> KnowledgeDocumentVersion:
    filename = file.filename or "upload.bin"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"不支持的文件扩展名: {ext}")
    content_type = (file.content_type or "").lower()
    if content_type and content_type not in ALLOWED_MIME:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"不支持的 MIME: {content_type}")

    version_no = await _next_version_no(db, doc.id)
    try:
        key, size, sha = storage.save_knowledge_upload(
            doc.id, version_no, filename, file.file, max_bytes=MAX_BYTES
        )
    except storage.StorageError as exc:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc))

    version = KnowledgeDocumentVersion(
        document_id=doc.id,
        version_no=version_no,
        storage_key=key,
        original_filename=filename,
        mime_type=content_type or None,
        file_size=size,
        sha256=sha,
        metadata_json={},
    )
    db.add(version)
    await db.flush()
    return version


@router.get("", response_model=Page[KnowledgeDocumentListItem])
async def list_documents(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    tag: str | None = None,
    source_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> Page[KnowledgeDocumentListItem]:
    base = select(KnowledgeDocument)
    if not include_deleted:
        base = base.where(KnowledgeDocument.is_deleted.is_(False))
    if source_type:
        _validate_source_type(source_type)
        base = base.where(KnowledgeDocument.source_type == source_type)
    if status_filter:
        _validate_status(status_filter)
        base = base.where(KnowledgeDocument.status == status_filter)
    if tag:
        base = base.where(KnowledgeDocument.tags.op("@>")([tag.strip()]))
    if q:
        like = f"%{q}%"
        base = base.where(
            or_(
                KnowledgeDocument.title.ilike(like),
                KnowledgeDocument.code.ilike(like),
            )
        )

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.execute(
            base.order_by(KnowledgeDocument.created_at.desc())
            .offset((page - 1) * size)
            .limit(size)
            .options(selectinload(KnowledgeDocument.current_version))
        )
    ).scalars().all()
    items = [_to_list_item(r) for r in rows]
    return Page(items=items, total=total, page=page, size=size)


@router.post("", response_model=KnowledgeDocumentOut, status_code=status.HTTP_201_CREATED)
async def create_metadata_only(
    body: KnowledgeDocumentCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> KnowledgeDocumentOut:
    source_type = _validate_source_type(body.source_type)
    _validate_status(body.status or KnowledgeDocumentStatus.DRAFT.value)
    code = body.code or generate_knowledge_document_code()
    existing = await db.scalar(select(KnowledgeDocument).where(KnowledgeDocument.code == code))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"编码已存在: {code}")
    if source_type == KnowledgeDocumentSourceType.URL.value and not body.source_url:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "URL 来源必须填写 source_url")

    doc = KnowledgeDocument(
        code=code,
        title=body.title,
        description=body.description,
        tags=_normalize_tags(body.tags),
        issued_at=body.issued_at,
        status=body.status or KnowledgeDocumentStatus.DRAFT.value,
        source_type=source_type,
        source_url=body.source_url,
        owner_id=user.id,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(doc)
    await db.flush()
    await write_audit(
        db,
        actor=user,
        action="knowledge_document.create",
        entity_type="knowledge_document",
        entity_id=doc.id,
        payload={
            "code": doc.code,
            "title": doc.title,
            "source_type": doc.source_type,
            "tags": doc.tags,
        },
    )
    await db.commit()
    await db.refresh(doc, attribute_names=["updated_at"])
    return _to_out(doc)


@router.post("/register-url", response_model=KnowledgeDocumentOut, status_code=status.HTTP_201_CREATED)
async def register_url(
    body: KnowledgeDocumentCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> KnowledgeDocumentOut:
    if not body.source_url:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "source_url 不能为空")
    body.source_type = KnowledgeDocumentSourceType.URL.value
    _validate_status(body.status or KnowledgeDocumentStatus.DRAFT.value)
    code = body.code or generate_knowledge_document_code()
    if (await db.scalar(select(KnowledgeDocument).where(KnowledgeDocument.code == code))) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"编码已存在: {code}")

    doc = KnowledgeDocument(
        code=code,
        title=body.title,
        description=body.description,
        tags=_normalize_tags(body.tags),
        issued_at=body.issued_at,
        status=body.status or KnowledgeDocumentStatus.DRAFT.value,
        source_type=KnowledgeDocumentSourceType.URL.value,
        source_url=body.source_url,
        owner_id=user.id,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(doc)
    await db.flush()
    version = KnowledgeDocumentVersion(
        document_id=doc.id,
        version_no=1,
        source_url=body.source_url,
        metadata_json={},
        created_by_id=user.id,
    )
    db.add(version)
    await db.flush()
    doc.current_version_id = version.id
    await write_audit(
        db,
        actor=user,
        action="knowledge_document.create",
        entity_type="knowledge_document",
        entity_id=doc.id,
        payload={
            "code": doc.code,
            "title": doc.title,
            "source_type": doc.source_type,
            "source_url": body.source_url,
        },
    )
    await db.commit()
    await db.refresh(doc, attribute_names=["updated_at"])
    return _to_out(doc)


@router.post("/uploads", response_model=KnowledgeDocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    code: str | None = Form(None),
    description: str | None = Form(None),
    tags: str | None = Form(None),
    issued_at: str | None = Form(None),
    status_filter: str | None = Form(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> KnowledgeDocumentOut:
    status_value = _validate_status(status_filter or KnowledgeDocumentStatus.DRAFT.value)
    code = code or generate_knowledge_document_code()
    if (await db.scalar(select(KnowledgeDocument).where(KnowledgeDocument.code == code))) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"编码已存在: {code}")

    def _parse_dt(v: str | None) -> datetime | None:
        if not v:
            return None
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"非法日期: {v}") from exc

    doc = KnowledgeDocument(
        code=code,
        title=title,
        description=description,
        tags=_normalize_tags(tags.split(",") if tags else []),
        issued_at=_parse_dt(issued_at),
        status=status_value or KnowledgeDocumentStatus.DRAFT.value,
        source_type=KnowledgeDocumentSourceType.UPLOAD.value,
        owner_id=user.id,
        created_by_id=user.id,
        updated_by_id=user.id,
    )
    db.add(doc)
    await db.flush()
    version = await _store_upload(db, doc, file)
    doc.current_version_id = version.id
    await write_audit(
        db,
        actor=user,
        action="knowledge_document.create",
        entity_type="knowledge_document",
        entity_id=doc.id,
        payload={
            "code": doc.code,
            "title": doc.title,
            "source_type": doc.source_type,
            "tags": doc.tags,
            "version_no": version.version_no,
            "sha256": version.sha256,
            "size": version.file_size,
        },
    )
    await db.commit()
    await db.refresh(doc, attribute_names=["updated_at"])
    return _to_out(doc)


@router.get("/{doc_id}", response_model=KnowledgeDocumentOut)
async def get_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> KnowledgeDocumentOut:
    doc = await db.scalar(
        select(KnowledgeDocument)
        .options(selectinload(KnowledgeDocument.current_version))
        .where(KnowledgeDocument.id == doc_id)
    )
    if doc is None or doc.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "知识文档不存在")
    return _to_out(doc)


@router.patch("/{doc_id}", response_model=KnowledgeDocumentOut)
async def update_document(
    doc_id: int,
    body: KnowledgeDocumentUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> KnowledgeDocumentOut:
    doc = await db.scalar(
        select(KnowledgeDocument)
        .options(selectinload(KnowledgeDocument.current_version))
        .where(KnowledgeDocument.id == doc_id)
    )
    if doc is None or doc.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "知识文档不存在")

    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"]:
        _validate_status(data["status"])
    if "tags" in data:
        data["tags"] = _normalize_tags(data["tags"])

    for k, v in data.items():
        setattr(doc, k, v)
    doc.updated_by_id = user.id

    await write_audit(
        db,
        actor=user,
        action="knowledge_document.update",
        entity_type="knowledge_document",
        entity_id=doc.id,
        payload={"fields": sorted(data.keys())},
    )
    await db.commit()
    await db.refresh(doc, attribute_names=["updated_at"])
    return _to_out(doc)


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> dict:
    doc = await db.scalar(select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id))
    if doc is None or doc.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "知识文档不存在")
    doc.is_deleted = True
    doc.deleted_at = datetime.utcnow()
    doc.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="knowledge_document.delete",
        entity_type="knowledge_document",
        entity_id=doc.id,
        payload={"code": doc.code},
    )
    await db.commit()
    return {"id": doc.id, "is_deleted": True}


@router.get("/{doc_id}/versions", response_model=List[KnowledgeDocumentVersionOut])
async def list_versions(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
) -> list[KnowledgeDocumentVersionOut]:
    doc = await db.scalar(select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id))
    if doc is None or doc.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "知识文档不存在")
    rows = (
        await db.execute(
            select(KnowledgeDocumentVersion)
            .where(KnowledgeDocumentVersion.document_id == doc_id)
            .order_by(KnowledgeDocumentVersion.version_no.desc())
        )
    ).scalars().all()
    return [KnowledgeDocumentVersionOut.model_validate(r) for r in rows]


@router.post(
    "/{doc_id}/versions",
    response_model=KnowledgeDocumentVersionOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_version(
    doc_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_writer),
) -> KnowledgeDocumentVersionOut:
    doc = await db.scalar(select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id))
    if doc is None or doc.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "知识文档不存在")
    version = await _store_upload(db, doc, file)
    doc.current_version_id = version.id
    doc.updated_by_id = user.id
    await write_audit(
        db,
        actor=user,
        action="knowledge_document.version.upload",
        entity_type="knowledge_document",
        entity_id=doc.id,
        payload={
            "version_no": version.version_no,
            "sha256": version.sha256,
            "size": version.file_size,
        },
    )
    await db.commit()
    await db.refresh(version)
    return KnowledgeDocumentVersionOut.model_validate(version)


@router.get("/{doc_id}/download")
async def download_version(
    doc_id: int,
    version_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_reader),
):
    doc = await db.scalar(select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id))
    if doc is None or doc.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "知识文档不存在")
    vid = version_id or doc.current_version_id
    if not vid:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "尚未上传文件版本")
    version = await db.scalar(
        select(KnowledgeDocumentVersion).where(
            and_(KnowledgeDocumentVersion.document_id == doc_id, KnowledgeDocumentVersion.id == vid)
        )
    )
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本不存在")
    if not version.storage_key:
        if version.source_url:
            return RedirectResponse(version.source_url, status_code=302)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本资源不存在")
    path = settings.storage_root / "uploads" / version.storage_key
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "版本资源已丢失")
    return FileResponse(
        path,
        media_type=version.mime_type or "application/octet-stream",
        filename=version.original_filename or f"knowledge-{doc_id}-v{version.version_no}",
    )
