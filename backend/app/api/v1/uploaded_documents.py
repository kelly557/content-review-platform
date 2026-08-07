"""UploadedDocument router (自定义规则 Agent — 上传 / 解析 / 状态查询 / Prompt 编辑)。"""
from __future__ import annotations

import hashlib
import io
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.models.uploaded_document import (
    UploadedDocument,
    UploadedDocKind,
    UploadedDocStatus,
)
from app.models.user import User
from app.schemas.uploaded_document import (
    DEFAULT_LLM_PROMPT,
    UploadedDocumentListResponse,
    UploadedDocumentOut,
    UploadedDocumentUpdate,
)
from app.services.uploaded_doc_parser import (
    ParsedAuditPointCandidate,
    classify_file_kind,
    parse_uploaded_file,
)
from app.tasks.background import spawn

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/packages/{code}/items/{item_id}/documents",
    tags=["uploaded-documents"],
)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB / file
ALLOWED_DOC_EXTS = {".pdf", ".docx", ".doc", ".txt", ".md", ".xlsx", ".xls", ".csv"}


# ─────────────── Helpers ───────────────


def _safe_doc_key(item_id: int, sha: str, original_filename: str) -> str:
    ext = Path(original_filename).suffix.lower() or ".bin"
    stamp = datetime.utcnow().strftime("%Y%m")
    return f"audit_items/{stamp}/{item_id}/{sha[:16]}{ext}"


async def _ensure_item(
    db: AsyncSession, code: str, item_id: int
) -> AuditItem:
    item = await db.get(AuditItem, item_id)
    if not item or item.package_code != code:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在"
        )
    return item


async def _serialize(doc: UploadedDocument) -> UploadedDocumentOut:
    return UploadedDocumentOut.model_validate(doc)


# ─────────────── List ───────────────


@router.get("", response_model=UploadedDocumentListResponse)
async def list_documents(
    code: str,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> UploadedDocumentListResponse:
    await _ensure_item(db, code, item_id)
    rows = (
        await db.execute(
            select(UploadedDocument)
            .where(UploadedDocument.item_id == item_id)
            .order_by(UploadedDocument.created_at.desc())
        )
    ).scalars().all()

    docs = [await _serialize(d) for d in rows]
    counts = {"parsed": 0, "failed": 0, "pending": 0, "parsing": 0}
    for d in docs:
        if d.status == UploadedDocStatus.PARSED:
            counts["parsed"] += 1
        elif d.status == UploadedDocStatus.FAILED:
            counts["failed"] += 1
        elif d.status == UploadedDocStatus.PENDING:
            counts["pending"] += 1
        elif d.status == UploadedDocStatus.PARSING:
            counts["parsing"] += 1

    return UploadedDocumentListResponse(
        item_id=item_id,
        documents=docs,
        total_count=len(docs),
        parsed_count=counts["parsed"],
        failed_count=counts["failed"],
        pending_count=counts["pending"] + counts["parsing"],
    )


# ─────────────── Upload (multi-file) ───────────────


@router.post("", response_model=list[UploadedDocumentOut], status_code=status.HTTP_201_CREATED)
async def upload_documents(
    code: str,
    item_id: int,
    files: list[UploadFile] = File(..., description="一个或多个源文件"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> list[UploadedDocumentOut]:
    item = await _ensure_item(db, code, item_id)
    if item.is_builtin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项不支持上传源文件",
        )

    if not files:
        raise HTTPException(status_code=400, detail="未提供文件")

    out: list[UploadedDocumentOut] = []
    saved_paths: list[Path] = []
    try:
        for f in files:
            if not f.filename:
                raise HTTPException(status_code=400, detail="缺少文件名")
            ext = Path(f.filename).suffix.lower()
            if ext not in ALLOWED_DOC_EXTS:
                raise HTTPException(
                    status_code=400,
                    detail=f"不支持的文件类型: {ext}",
                )
            content = await f.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"{f.filename} 文件为空")
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=f"{f.filename} 超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 上限",
                )

            sha = hashlib.sha256(content).hexdigest()
            kind_str = classify_file_kind(f.filename)
            kind = UploadedDocKind.STRUCTURED if kind_str == "structured" else UploadedDocKind.LLM
            storage_key = _safe_doc_key(item_id, sha, f.filename)

            # 落盘 (与现有 storage.py 行为一致，使用 settings.storage_root)
            settings.ensure_storage_dirs()
            dest = settings.storage_root / "uploads" / storage_key
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("wb") as fh:
                fh.write(content)
            saved_paths.append(dest)

            doc = UploadedDocument(
                item_id=item_id,
                package_code=code,
                original_filename=f.filename,
                kind=kind,
                storage_key=storage_key,
                size_bytes=len(content),
                sha256=sha,
                mime_type=f.content_type,
                status=UploadedDocStatus.PENDING,
                prompt_markdown=DEFAULT_LLM_PROMPT if kind == UploadedDocKind.LLM else None,
                created_by=current_user.id,
            )
            db.add(doc)
            await db.flush()
            out.append(await _serialize(doc))

        await db.commit()
    except Exception:
        # 失败时回滚 DB；尽量清理已写入的文件
        await db.rollback()
        for p in saved_paths:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        raise

    # 入库成功后，异步触发解析任务
    for d in out:
        spawn(
            lambda doc_id=d.id: _run_parse_document(doc_id),
            name=f"parse-uploaded-doc-{d.id}",
        )

    return out


# ─────────────── Get one ───────────────


@router.get("/{doc_id}", response_model=UploadedDocumentOut)
async def get_document(
    code: str,
    item_id: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> UploadedDocumentOut:
    await _ensure_item(db, code, item_id)
    doc = await db.get(UploadedDocument, doc_id)
    if not doc or doc.item_id != item_id:
        raise HTTPException(status_code=404, detail="文档不存在")
    return await _serialize(doc)


# ─────────────── Update Prompt / re-parse ───────────────


@router.put("/{doc_id}/prompt", response_model=UploadedDocumentOut)
async def update_document_prompt(
    code: str,
    item_id: int,
    doc_id: int,
    body: UploadedDocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> UploadedDocumentOut:
    item = await _ensure_item(db, code, item_id)
    if item.is_builtin:
        raise HTTPException(status_code=422, detail="通用审核项不支持 Prompt 编辑")
    doc = await db.get(UploadedDocument, doc_id)
    if not doc or doc.item_id != item_id:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.kind != UploadedDocKind.LLM:
        raise HTTPException(
            status_code=422,
            detail="仅 LLM 类文件支持自定义 Prompt",
        )
    if body.prompt_markdown is not None:
        doc.prompt_markdown = body.prompt_markdown or None
    await db.flush()
    await db.commit()
    await db.refresh(doc)
    return await _serialize(doc)


@router.post("/{doc_id}/reparse", response_model=UploadedDocumentOut)
async def reparse_document(
    code: str,
    item_id: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> UploadedDocumentOut:
    """手动触发重新解析（适用于修复 Prompt 后 / 失败重试）。"""
    item = await _ensure_item(db, code, item_id)
    if item.is_builtin:
        raise HTTPException(status_code=422, detail="通用审核项不支持重新解析")
    doc = await db.get(UploadedDocument, doc_id)
    if not doc or doc.item_id != item_id:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.status == UploadedDocStatus.PARSING:
        raise HTTPException(status_code=409, detail="解析进行中，请稍候")

    # 重置状态 & 清空错误信息
    doc.status = UploadedDocStatus.PENDING
    doc.error_message = None
    doc.parsed_at = None
    await db.flush()
    await db.commit()
    await db.refresh(doc)

    spawn(
        lambda doc_id=doc.id: _run_parse_document(doc_id),
        name=f"reparse-uploaded-doc-{doc.id}",
    )
    return await _serialize(doc)


# ─────────────── Delete ───────────────


@router.delete(
    "/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_document(
    code: str,
    item_id: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> Response:
    item = await _ensure_item(db, code, item_id)
    if item.is_builtin:
        raise HTTPException(status_code=422, detail="通用审核项不支持删除源文件")
    doc = await db.get(UploadedDocument, doc_id)
    if not doc or doc.item_id != item_id:
        raise HTTPException(status_code=404, detail="文档不存在")

    # 先删除由该文件解析出的所有 AuditPoint（保留 item 本身）
    await db.execute(
        delete(AuditPoint).where(AuditPoint.source_document_id == doc.id)
    )
    # 删除磁盘文件
    try:
        file_path = settings.storage_root / "uploads" / doc.storage_key
        file_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("failed to remove file %s", doc.storage_key)
    # 删除文档记录
    await db.delete(doc)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─────────────── Download ───────────────


@router.get("/{doc_id}/download")
async def download_document(
    code: str,
    item_id: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> StreamingResponse:
    await _ensure_item(db, code, item_id)
    doc = await db.get(UploadedDocument, doc_id)
    if not doc or doc.item_id != item_id:
        raise HTTPException(status_code=404, detail="文档不存在")
    file_path = settings.storage_root / "uploads" / doc.storage_key
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="文件已丢失")
    # 简单流式下载
    def iterfile():
        with file_path.open("rb") as f:
            while True:
                chunk = f.read(1024 * 64)
                if not chunk:
                    break
                yield chunk

    headers = {
        "Content-Disposition": (
            f"attachment; filename=\"{doc.original_filename}\""
        ),
    }
    return StreamingResponse(
        iterfile(),
        media_type=doc.mime_type or "application/octet-stream",
        headers=headers,
    )


# ─────────────── Background parser worker ───────────────


async def _run_parse_document(doc_id: int) -> None:
    """后台解析任务：加载文件 → 调用解析器 → 写入 AuditPoint → 更新状态。

    使用独立 session，避免与请求会话冲突。
    """
    from app.db.session import SessionLocal

    async with SessionLocal() as db:
        try:
            doc = await db.get(UploadedDocument, doc_id)
            if not doc:
                logger.warning("parse worker: doc %s not found", doc_id)
                return

            doc.status = UploadedDocStatus.PARSING
            doc.error_message = None
            await db.commit()

            file_path = settings.storage_root / "uploads" / doc.storage_key
            if not file_path.is_file():
                raise RuntimeError(f"文件丢失: {doc.storage_key}")
            content = file_path.read_bytes()

            # 删除旧点 (重解析时)
            await db.execute(
                delete(AuditPoint).where(AuditPoint.source_document_id == doc.id)
            )
            await db.flush()

            candidates: list[ParsedAuditPointCandidate] = await parse_uploaded_file(
                kind=doc.kind.value,
                content=content,
                filename=doc.original_filename,
                prompt_markdown=doc.prompt_markdown,
            )

            # 写入新点
            from app.models.audit_point import AuditPoint as _AP  # 局部避免循环

            # 编码生成 — 包含 doc_id 以保证跨文档唯一性
            # 格式：ap_{item_id}_{doc_id}_{n}
            new_points = []
            for idx, cand in enumerate(candidates):
                code = f"ap_{doc.item_id}_{doc.id}_{idx + 1}"
                point = _AP(
                    package_code=doc.package_code,
                    item_id=doc.item_id,
                    code=code,
                    label=code,
                    label_cn=cand.label_cn[:64],
                    scope_text=(cand.scope_text or "")[:255] or None,
                    is_enabled=False,
                    is_builtin=False,
                    source_document_id=doc.id,
                    source_quote=(cand.source_quote or "")[:65535] or None,
                    source_line_no=cand.source_line_no,
                )
                db.add(point)
                new_points.append(point)
            await db.flush()

            doc.parsed_point_count = len(new_points)
            doc.status = UploadedDocStatus.PARSED
            doc.parsed_at = datetime.utcnow()
            doc.error_message = None
            await db.commit()
            logger.info(
                "parse worker: doc=%s parsed=%s points", doc.id, len(new_points)
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("parse worker failed: doc=%s", doc_id)
            try:
                # 当前 session 可能处于失败状态；rollback 后再获取并标记失败
                await db.rollback()
                doc = await db.get(UploadedDocument, doc_id)
                if doc:
                    doc.status = UploadedDocStatus.FAILED
                    doc.error_message = f"{type(exc).__name__}: {exc}"[:2000]
                    await db.commit()
            except Exception:  # noqa: BLE001
                logger.exception("failed to record parse failure: doc=%s", doc_id)