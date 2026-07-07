"""Knowledge base API (admin / mlr only).

Endpoints
---------
GET    /api/v1/knowledge/documents                       list documents
POST   /api/v1/knowledge/documents                       upload + extract text
GET    /api/v1/knowledge/documents/{id}                  detail (with extractions)
DELETE /api/v1/knowledge/documents/{id}                  delete (admin only)
POST   /api/v1/knowledge/documents/{id}/extract          trigger MaaS extraction
GET    /api/v1/knowledge/extractions/{id}                extraction tree
PATCH  /api/v1/knowledge/extraction-items/{id}           edit item draft
PATCH  /api/v1/knowledge/extraction-points/{id}          edit point draft
POST   /api/v1/knowledge/extractions/{id}/import         confirm & write through
"""
from __future__ import annotations

import logging
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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.knowledge_document import (
    KnowledgeDocument,
    KnowledgeDocumentStatus,
    KnowledgeScope,
)
from app.models.knowledge_extraction import (
    KnowledgeExtraction,
    KnowledgeExtractionItem,
    KnowledgeExtractionPoint,
)
from app.models.user import User
from app.models.tag import TagDomain
from app.schemas.common import Page
from app.schemas.knowledge_document import (
    KnowledgeDocumentDetail,
    KnowledgeDocumentListResponse,
    KnowledgeDocumentOut,
    KnowledgeDocumentSummary,
    KnowledgeExtractionSummary,
    KnowledgeExtractionTriggerRequest,
)
from app.schemas.knowledge_extraction import (
    KnowledgeExtractionItemPatch,
    KnowledgeExtractionOut,
    KnowledgeExtractionPointPatch,
    KnowledgeImportRequest,
    KnowledgeImportResult,
)
from app.services import knowledge as kb_service
from app.services import storage
from app.services.knowledge import KnowledgeError, extract_storage_text

log = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _doc_to_out(doc: KnowledgeDocument) -> KnowledgeDocumentOut:
    return KnowledgeDocumentOut(
        id=doc.id,
        title=doc.title,
        original_filename=doc.original_filename,
        mime_type=doc.mime_type,
        file_size=doc.file_size,
        domain=doc.domain,
        scope=doc.scope,
        tag_ids=list(doc.tag_ids or []),
        target_service_code=doc.target_service_code,
        status=doc.status,
        error_message=doc.error_message,
        created_by_id=doc.created_by_id,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


def _doc_to_summary(doc: KnowledgeDocument) -> KnowledgeDocumentSummary:
    return KnowledgeDocumentSummary(
        id=doc.id,
        title=doc.title,
        original_filename=doc.original_filename,
        mime_type=doc.mime_type,
        file_size=doc.file_size,
        domain=doc.domain,
        scope=doc.scope,
        tag_ids=list(doc.tag_ids or []),
        status=doc.status,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


@router.get("/documents", response_model=KnowledgeDocumentListResponse)
async def list_documents(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    domain: Optional[TagDomain] = None,
    status_: Optional[KnowledgeDocumentStatus] = Query(None, alias="status"),
    q: Optional[str] = None,
) -> KnowledgeDocumentListResponse:
    items, total = await kb_service.list_documents(
        db, page=page, size=size, domain=domain, status=status_, q=q
    )
    return KnowledgeDocumentListResponse(
        items=[_doc_to_summary(d) for d in items],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "/documents",
    response_model=KnowledgeDocumentDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    title: str = Form(..., min_length=1, max_length=255),
    domain: TagDomain = Form(...),
    scope: KnowledgeScope = Form(...),
    tag_ids: str = Form("", description="逗号分隔的 tag UUID；空表示无"),
    target_service_code: Optional[str] = Form(None, max_length=64),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles("admin", "mlr")),
) -> KnowledgeDocumentDetail:
    if file.content_type and file.content_type not in settings.storage_allowed_mime:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"mime {file.content_type} 不允许，仅支持 pdf/txt/md",
        )

    parsed_tag_ids = [t.strip() for t in tag_ids.split(",") if t.strip()]
    if target_service_code:
        target_service_code = target_service_code.strip() or None

    raw = await file.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="上传文件为空"
        )
    if len(raw) > settings.storage_max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"文件超过 {settings.storage_max_upload_mb}MB 限制",
        )

    import hashlib as _hashlib
    import io as _io
    import uuid as _uuid

    doc_id = str(_uuid.uuid4())
    mime = file.content_type or "application/octet-stream"
    try:
        storage_key, size, sha = storage.save_knowledge_upload(
            doc_id, file.filename or "upload.bin", _io.BytesIO(raw)
        )
    except storage.StorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        extracted_text = extract_storage_text(
            mime_type=mime,
            storage_root_path=settings.storage_root,
            storage_key=storage_key,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("knowledge text extract failed: %s", exc)
        extracted_text = None

    doc = await kb_service.create_document(
        db,
        title=title.strip() or (file.filename or "未命名文档"),
        original_filename=file.filename or "upload.bin",
        mime_type=mime,
        storage_key=storage_key,
        file_size=size,
        checksum=sha,
        domain=domain,
        scope=scope,
        tag_ids=parsed_tag_ids,
        target_service_code=target_service_code,
        extracted_text=extracted_text,
        created_by_id=user.id,
    )
    await db.commit()
    await db.refresh(doc)
    return KnowledgeDocumentDetail(**_doc_to_out(doc).model_dump(), extractions=[])


@router.get("/documents/{doc_id}", response_model=KnowledgeDocumentDetail)
async def get_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> KnowledgeDocumentDetail:
    doc = await kb_service.get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    exts_stmt = (
        select(KnowledgeExtraction)
        .where(KnowledgeExtraction.document_id == doc_id)
        .order_by(KnowledgeExtraction.round_no.desc())
    )
    exts = list((await db.execute(exts_stmt)).scalars())
    extractions = [
        KnowledgeExtractionSummary(
            id=e.id,
            document_id=e.document_id,
            round_no=e.round_no,
            model=e.model,
            prompt_tokens=e.prompt_tokens,
            completion_tokens=e.completion_tokens,
            status=e.status.value,
            error_message=e.error_message,
            chunk_count=e.chunk_count,
            created_at=e.created_at,
        )
        for e in exts
    ]
    return KnowledgeDocumentDetail(**_doc_to_out(doc).model_dump(), extractions=extractions)


@router.delete("/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin")),
) -> None:
    doc = await kb_service.get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    try:
        storage.delete_object(doc.storage_key)
    except Exception as exc:  # noqa: BLE001
        log.warning("storage cleanup failed for %s: %s", doc.storage_key, exc)
    await kb_service.delete_document(db, doc)
    await db.commit()


@router.post(
    "/documents/{doc_id}/extract",
    response_model=KnowledgeExtractionOut,
)
async def trigger_extraction(
    doc_id: str,
    body: Optional[KnowledgeExtractionTriggerRequest] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> KnowledgeExtractionOut:
    doc = await kb_service.get_document(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    force = bool(body and body.force)
    try:
        extraction = await kb_service.trigger_extraction(db, doc, force=force)
    except KnowledgeError as exc:
        await db.commit()
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    out = await kb_service.get_extraction_full(db, extraction.id)
    if not out:
        raise HTTPException(status_code=500, detail="抽取后无法读取结果")
    return out


@router.get("/extractions/{ext_id}", response_model=KnowledgeExtractionOut)
async def get_extraction(
    ext_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> KnowledgeExtractionOut:
    out = await kb_service.get_extraction_full(db, ext_id)
    if not out:
        raise HTTPException(status_code=404, detail="抽取记录不存在")
    return out


@router.patch("/extraction-items/{item_id}")
async def patch_item(
    item_id: str,
    body: KnowledgeExtractionItemPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
):
    item = await db.get(KnowledgeExtractionItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="审核项草稿不存在")
    await kb_service.patch_item(
        db,
        item,
        name_cn=body.name_cn,
        aliases=body.aliases,
        description=body.description,
        sort_order=body.sort_order,
        selected=body.selected,
    )
    await db.commit()
    return {"id": item.id, "selected": item.selected, "name_cn": item.name_cn}


@router.patch("/extraction-points/{point_id}")
async def patch_point(
    point_id: str,
    body: KnowledgeExtractionPointPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
):
    point = await db.get(KnowledgeExtractionPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="审核点草稿不存在")
    try:
        await kb_service.patch_point(
            db,
            point,
            label_cn=body.label_cn,
            description=body.description,
            judgment_logic=body.judgment_logic,
            judgment_rule=body.judgment_rule,
            judgment_basis=body.judgment_basis,
            risk_level=body.risk_level,
            medium_threshold=body.medium_threshold,
            high_threshold=body.high_threshold,
            scope_text=body.scope_text,
            selected=body.selected,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return {"id": point.id, "selected": point.selected}


@router.post(
    "/extractions/{ext_id}/import",
    response_model=KnowledgeImportResult,
)
async def import_extraction(
    ext_id: str,
    body: KnowledgeImportRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "mlr")),
) -> KnowledgeImportResult:
    ext = await kb_service.get_extraction(db, ext_id)
    if not ext:
        raise HTTPException(status_code=404, detail="抽取记录不存在")
    try:
        result = await kb_service.import_selected(db, ext, body)
    except KnowledgeError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return result