"""Knowledge base orchestration.

Public API:
    create_document(...)          # upload + extract text + persist
    trigger_extraction(...)       # call MaaS, persist draft items/points
    patch_item(...) / patch_point(...)
    import_selected(...)          # confirm & write through to AuditItem/AuditPoint

The service is intentionally tolerant of partial failures — any unhandled
exception during extraction flips the document to ``failed`` and records the
error message; the caller can ``trigger_extraction(force=True)`` to retry.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint, AuditPointRisk
from app.models.knowledge_document import (
    KnowledgeDocument,
    KnowledgeDocumentStatus,
    KnowledgeExtractionStatus,
    KnowledgeScope,
)
from app.models.knowledge_extraction import (
    KnowledgeExtraction,
    KnowledgeExtractionItem,
    KnowledgeExtractionPoint,
)
from app.models.service import Service, ServiceScope
from app.models.tag import TagDomain
from app.schemas.knowledge_document import (
    KnowledgeDocumentDetail,
    KnowledgeDocumentOut,
    KnowledgeDocumentSummary,
    KnowledgeExtractionSummary,
)
from app.schemas.knowledge_extraction import (
    KnowledgeExtractionItemOut,
    KnowledgeExtractionOut,
    KnowledgeExtractionPointOut,
    KnowledgeImportRequest,
    KnowledgeImportResult,
)
from app.services.llm.extraction_prompt import (
    build_user_prompt,
    get_extraction_schema,
    SYSTEM_PROMPT,
)
from app.services.llm.maas_client import MaaSClient, MaaSError, get_maas_client
from app.services.llm.text_extractor import (
    chunk_by_paragraph,
    extract_text,
    TextExtractionError,
)

log = logging.getLogger(__name__)


class KnowledgeError(Exception):
    pass


def _slug_suffix(domain: TagDomain, scope: KnowledgeScope) -> str:
    return f"{domain.value}_{re.sub(r'[^A-Za-z0-9]+', '_', scope.value).strip('_').lower()}"


def _service_code_for(domain: TagDomain, scope: KnowledgeScope) -> str:
    suffix = _slug_suffix(domain, scope)
    return f"knowledge_{suffix}"[:64]


def _normalize_text(s: Optional[str], limit: int = 4000) -> str:
    if not s:
        return ""
    s = s.strip()
    if len(s) > limit:
        s = s[:limit] + "…"
    return s


def _safe_label(label_cn: str, fallback: str = "未命名审核点") -> str:
    label_cn = (label_cn or "").strip()
    if not label_cn:
        return fallback
    return label_cn[:64]


def _safe_item_code(domain: TagDomain, n: int) -> str:
    return f"kb_{domain.value}_{n}"[:64]


def _safe_point_code(item_code: str, m: int) -> str:
    return f"{item_code}_p{m}"[:64]


async def _get_or_create_knowledge_service(
    db: AsyncSession, *, service_code: str, domain: TagDomain, scope: KnowledgeScope
) -> Service:
    """Get or create the dedicated knowledge rule package.

    Idempotent — repeated imports re-use the same Service so the resulting
    AuditItem/AuditPoint all hang off a stable code.
    """
    result = await db.execute(select(Service).where(Service.code == service_code))
    svc = result.scalar_one_or_none()
    if svc:
        return svc
    svc = Service(
        code=service_code,
        name=f"知识库 · {domain.value} · {scope.value}",
        scope=ServiceScope.GENERAL,
        description=f"由知识库自动抽取生成的规则包（{domain.value} / {scope.value}）。",
        is_active=True,
        is_custom=True,
        is_rule_package=True,
        category_id=None,
    )
    db.add(svc)
    await db.flush()
    return svc


async def create_document(
    db: AsyncSession,
    *,
    title: str,
    original_filename: str,
    mime_type: str,
    storage_key: str,
    file_size: int,
    checksum: str,
    domain: TagDomain,
    scope: KnowledgeScope,
    tag_ids: List[str],
    target_service_code: Optional[str],
    extracted_text: Optional[str],
    created_by_id: Optional[int],
) -> KnowledgeDocument:
    """Persist a freshly uploaded knowledge document + extracted text."""
    doc = KnowledgeDocument(
        title=title,
        original_filename=original_filename,
        storage_key=storage_key,
        mime_type=mime_type,
        file_size=file_size,
        checksum=checksum,
        extracted_text=extracted_text,
        domain=domain,
        scope=scope,
        tag_ids=tag_ids,
        target_service_code=target_service_code,
        status=KnowledgeDocumentStatus.DRAFT,
        created_by_id=created_by_id,
    )
    db.add(doc)
    await db.flush()
    return doc


async def list_documents(
    db: AsyncSession,
    *,
    page: int,
    size: int,
    domain: Optional[TagDomain] = None,
    status: Optional[KnowledgeDocumentStatus] = None,
    q: Optional[str] = None,
) -> Tuple[List[KnowledgeDocument], int]:
    stmt = select(KnowledgeDocument)
    if domain:
        stmt = stmt.where(KnowledgeDocument.domain == domain)
    if status:
        stmt = stmt.where(KnowledgeDocument.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(KnowledgeDocument.title.ilike(like))
    total = await db.scalar(
        select(func.count()).select_from(stmt.subquery())
    ) or 0
    stmt = (
        stmt.order_by(KnowledgeDocument.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    rows = list((await db.execute(stmt)).scalars())
    return rows, int(total)


async def get_document(db: AsyncSession, doc_id: str) -> Optional[KnowledgeDocument]:
    return await db.get(KnowledgeDocument, doc_id)


async def delete_document(db: AsyncSession, doc: KnowledgeDocument) -> None:
    await db.delete(doc)
    await db.flush()


async def get_extraction(db: AsyncSession, ext_id: str) -> Optional[KnowledgeExtraction]:
    return await db.get(KnowledgeExtraction, ext_id)


async def get_extraction_full(
    db: AsyncSession, ext_id: str
) -> Optional[KnowledgeExtractionOut]:
    ext = await db.get(KnowledgeExtraction, ext_id)
    if not ext:
        return None
    items_stmt = (
        select(KnowledgeExtractionItem)
        .where(KnowledgeExtractionItem.extraction_id == ext_id)
        .order_by(
            KnowledgeExtractionItem.sort_order.asc(),
            KnowledgeExtractionItem.created_at.asc(),
        )
    )
    items = list((await db.execute(items_stmt)).scalars())
    item_ids = [i.id for i in items]
    points: Dict[str, List[KnowledgeExtractionPoint]] = {}
    if item_ids:
        pts_stmt = (
            select(KnowledgeExtractionPoint)
            .where(KnowledgeExtractionPoint.item_draft_id.in_(item_ids))
            .order_by(
                KnowledgeExtractionPoint.created_at.asc(),
            )
        )
        for p in (await db.execute(pts_stmt)).scalars():
            points.setdefault(p.item_draft_id, []).append(p)

    item_outs = []
    for it in items:
        pts = [
            KnowledgeExtractionPointOut.model_validate(p) for p in points.get(it.id, [])
        ]
        base = KnowledgeExtractionItemOut.model_validate(it).model_copy(
            update={"points": pts}
        )
        item_outs.append(base)
    return KnowledgeExtractionOut(
        id=ext.id,
        document_id=ext.document_id,
        round_no=ext.round_no,
        model=ext.model,
        prompt_tokens=ext.prompt_tokens,
        completion_tokens=ext.completion_tokens,
        raw_response=ext.raw_response,
        status=ext.status.value if hasattr(ext.status, "value") else str(ext.status),
        error_message=ext.error_message,
        chunk_count=ext.chunk_count,
        created_at=ext.created_at,
        items=item_outs,
    )


async def _persist_extraction_items(
    db: AsyncSession,
    extraction: KnowledgeExtraction,
    items_payload: List[Dict[str, Any]],
) -> int:
    """Write draft items + points for a single chunk. Returns # of points."""
    point_count = 0
    for idx, item_data in enumerate(items_payload, start=1):
        name_cn = (item_data.get("name_cn") or "").strip() or f"未命名审核项 {idx}"
        item_code = (item_data.get("code") or "").strip() or _safe_item_code(
            TagDomain("custom"), idx
        )
        if len(item_code) > 64:
            item_code = item_code[:64]
        aliases = item_data.get("aliases") or []
        if not isinstance(aliases, list):
            aliases = []
        item = KnowledgeExtractionItem(
            extraction_id=extraction.id,
            code=item_code,
            name_cn=name_cn[:64],
            aliases=[str(a)[:64] for a in aliases if str(a).strip()],
            description=_normalize_text(item_data.get("description")),
            sort_order=idx * 10,
            selected=True,
        )
        db.add(item)
        await db.flush()

        for m, pt in enumerate(item_data.get("points") or [], start=1):
            if not isinstance(pt, dict):
                continue
            label_cn = _safe_label(pt.get("label_cn"))
            logic = pt.get("judgment_logic") or {}
            if not isinstance(logic, dict):
                logic = {}
            logic_type = (logic.get("type") or "keyword_match").lower()
            if logic_type not in {"keyword_match", "regex", "semantic", "threshold"}:
                logic_type = "keyword_match"
            logic_obj = {
                "type": logic_type,
                "expr": str(logic.get("expr") or "")[:512],
                "params": logic.get("params") if isinstance(logic.get("params"), dict) else {},
            }
            risk = pt.get("risk_level") or "中风险"
            if risk not in {"低风险", "中风险", "高风险"}:
                risk = "中风险"
            point_code = _safe_point_code(item_code, m)
            point = KnowledgeExtractionPoint(
                extraction_id=extraction.id,
                item_draft_id=item.id,
                code=point_code,
                label=label_cn,
                label_cn=label_cn,
                description=_normalize_text(pt.get("description"), 2000),
                judgment_logic=logic_obj,
                judgment_rule=_normalize_text(pt.get("judgment_rule"), 4000),
                judgment_basis=_normalize_text(pt.get("judgment_basis"), 4000),
                risk_level=AuditPointRisk(risk),
                medium_threshold=60.0,
                high_threshold=90.0,
                scope_text=_normalize_text(pt.get("scope_text"), 255),
                selected=True,
            )
            db.add(point)
            point_count += 1
    await db.flush()
    return point_count


async def trigger_extraction(
    db: AsyncSession,
    doc: KnowledgeDocument,
    *,
    client: Optional[MaaSClient] = None,
    force: bool = False,
) -> KnowledgeExtraction:
    """Run (or re-run) extraction for a document.

    Errors flip the document status to ``failed`` and record the message.
    Raises ``KnowledgeError`` only on unrecoverable precondition failures.
    """
    if not doc.extracted_text:
        raise KnowledgeError("文档尚未抽取纯文本，无法抽取规则")

    if doc.status == KnowledgeDocumentStatus.IMPORTED and not force:
        raise KnowledgeError("文档已导入；如需重新抽取请传 force=true")

    client = client or get_maas_client()
    if not client.enabled:
        doc.status = KnowledgeDocumentStatus.FAILED
        doc.error_message = "MaaS 未启用或缺少 MAAS_API_KEY"
        await db.flush()
        raise KnowledgeError(doc.error_message)

    prev_round = await db.scalar(
        select(func.max(KnowledgeExtraction.round_no)).where(
            KnowledgeExtraction.document_id == doc.id
        )
    )
    round_no = int(prev_round or 0) + 1
    extraction = KnowledgeExtraction(
        document_id=doc.id,
        round_no=round_no,
        model=client.model,
        status=KnowledgeExtractionStatus.PENDING,
        chunk_count=1,
    )
    db.add(extraction)
    await db.flush()

    doc.status = KnowledgeDocumentStatus.EXTRACTING
    doc.error_message = None
    await db.flush()

    chunks = chunk_by_paragraph(doc.extracted_text, settings.maas_max_text_chars)
    extraction.chunk_count = max(1, len(chunks))
    schema = get_extraction_schema()
    aggregated_items: List[Dict[str, Any]] = []
    raw_responses: List[str] = []

    try:
        for ci, chunk in enumerate(chunks or [doc.extracted_text]):
            prompt = build_user_prompt(
                chunk, domain=doc.domain.value, scope=doc.scope.value
            )
            try:
                result = await client.chat_json(
                    system=SYSTEM_PROMPT, user=prompt, schema=schema
                )
            except MaaSError as exc:
                raise KnowledgeError(f"MaaS 调用失败: {exc}") from exc
            raw_responses.append(json.dumps(result, ensure_ascii=False)[:10000])
            chunk_items = result.get("items") if isinstance(result, dict) else None
            if isinstance(chunk_items, list):
                aggregated_items.extend([it for it in chunk_items if isinstance(it, dict)])

        if not aggregated_items:
            aggregated_items = []

        await _persist_extraction_items(db, extraction, aggregated_items)
        extraction.status = KnowledgeExtractionStatus.SUCCEEDED
        extraction.raw_response = "\n\n---chunk---\n\n".join(raw_responses) or None
        all_items = list(
            (
                await db.execute(
                    select(KnowledgeExtractionItem).where(
                        KnowledgeExtractionItem.extraction_id == extraction.id
                    )
                )
            ).scalars()
        )
        if all_items and all(it.imported_item_id is not None for it in all_items):
            doc.status = KnowledgeDocumentStatus.IMPORTED
        else:
            doc.status = KnowledgeDocumentStatus.REVIEW
        await db.flush()
        return extraction
    except KnowledgeError as exc:
        extraction.status = KnowledgeExtractionStatus.FAILED
        extraction.error_message = str(exc)[:4000]
        doc.status = KnowledgeDocumentStatus.FAILED
        doc.error_message = extraction.error_message
        await db.flush()
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("Extraction failed for doc %s", doc.id)
        extraction.status = KnowledgeExtractionStatus.FAILED
        extraction.error_message = f"{exc.__class__.__name__}: {exc}"[:4000]
        doc.status = KnowledgeDocumentStatus.FAILED
        doc.error_message = extraction.error_message
        await db.flush()
        raise KnowledgeError(extraction.error_message) from exc


async def patch_item(
    db: AsyncSession,
    item: KnowledgeExtractionItem,
    *,
    name_cn: Optional[str],
    aliases: Optional[List[str]],
    description: Optional[str],
    sort_order: Optional[int],
    selected: Optional[bool],
) -> KnowledgeExtractionItem:
    if name_cn is not None:
        item.name_cn = name_cn
    if aliases is not None:
        item.aliases = [str(a)[:64] for a in aliases if str(a).strip()]
    if description is not None:
        item.description = description
    if sort_order is not None:
        item.sort_order = sort_order
    if selected is not None:
        item.selected = selected
    await db.flush()
    return item


async def patch_point(
    db: AsyncSession,
    point: KnowledgeExtractionPoint,
    *,
    label_cn: Optional[str],
    description: Optional[str],
    judgment_logic: Optional[Dict[str, Any]],
    judgment_rule: Optional[str],
    judgment_basis: Optional[str],
    risk_level: Optional[AuditPointRisk],
    medium_threshold: Optional[float],
    high_threshold: Optional[float],
    scope_text: Optional[str],
    selected: Optional[bool],
) -> KnowledgeExtractionPoint:
    if label_cn is not None:
        point.label_cn = label_cn
        point.label = label_cn
    if description is not None:
        point.description = description
    if judgment_logic is not None:
        point.judgment_logic = judgment_logic
    if judgment_rule is not None:
        point.judgment_rule = judgment_rule
    if judgment_basis is not None:
        point.judgment_basis = judgment_basis
    if risk_level is not None:
        point.risk_level = risk_level
    if medium_threshold is not None:
        point.medium_threshold = medium_threshold
    if high_threshold is not None:
        point.high_threshold = high_threshold
    if scope_text is not None:
        point.scope_text = scope_text
    if selected is not None:
        point.selected = selected
    await db.flush()
    return point


async def import_selected(
    db: AsyncSession,
    ext: KnowledgeExtraction,
    request: KnowledgeImportRequest,
) -> KnowledgeImportResult:
    """Write user-confirmed items / points to AuditItem / AuditPoint."""
    doc = await db.get(KnowledgeDocument, ext.document_id)
    if not doc:
        raise KnowledgeError("extraction belongs to a missing document")

    items_stmt = select(KnowledgeExtractionItem).where(
        KnowledgeExtractionItem.extraction_id == ext.id
    )
    items = list((await db.execute(items_stmt)).scalars())
    item_by_id: Dict[str, KnowledgeExtractionItem] = {it.id: it for it in items}

    requested_ids = set(request.item_ids) if request.item_ids else None
    target_items: List[KnowledgeExtractionItem] = []
    for it in items:
        if it.imported_item_id:
            continue
        if requested_ids is None:
            if it.selected:
                target_items.append(it)
        elif it.id in requested_ids and it.selected:
            target_items.append(it)

    if not target_items:
        raise KnowledgeError("没有可导入的审核项（全部已导入或未勾选）")

    target_item_ids = {it.id for it in target_items}
    pts_stmt = select(KnowledgeExtractionPoint).where(
        KnowledgeExtractionPoint.item_draft_id.in_(target_item_ids)
    )
    points = list((await db.execute(pts_stmt)).scalars())

    point_overrides = request.point_overrides or {}
    target_points: List[KnowledgeExtractionPoint] = []
    for p in points:
        if p.imported_point_id:
            continue
        if p.id in point_overrides:
            if point_overrides[p.id]:
                target_points.append(p)
        elif p.selected and p.item_draft_id in target_item_ids:
            target_points.append(p)

    if not target_points:
        raise KnowledgeError("所选审核项下没有可导入的审核点")

    service_code = request.target_service_code or doc.target_service_code
    if not service_code:
        service_code = _service_code_for(doc.domain, doc.scope)
    svc = await _get_or_create_knowledge_service(
        db, service_code=service_code, domain=doc.domain, scope=doc.scope
    )

    item_id_map: Dict[str, int] = {}
    point_id_map: Dict[str, int] = {}

    for it in target_items:
        existing_audit_items = await db.execute(
            select(func.count(AuditItem.id)).where(
                AuditItem.package_code == svc.code,
                AuditItem.code == it.code,
            )
        )
        if (existing_audit_items.scalar() or 0) > 0:
            it.code = f"{it.code[:48]}_r{ext.round_no}"[:64]

        audit_item = AuditItem(
            package_code=svc.code,
            code=it.code,
            name_cn=it.name_cn,
            aliases=list(it.aliases or []),
            description=it.description,
            sort_order=it.sort_order,
            is_enabled=request.enable_imported,
        )
        db.add(audit_item)
        await db.flush()
        it.imported_item_id = audit_item.id
        item_id_map[it.id] = audit_item.id

    item_points: Dict[str, List[KnowledgeExtractionPoint]] = {}
    for p in target_points:
        item_points.setdefault(p.item_draft_id, []).append(p)

    for draft_item_id, pts in item_points.items():
        item_id = item_id_map.get(draft_item_id)
        if not item_id:
            continue
        for sort_idx, p in enumerate(pts, start=1):
            existing_pts = await db.execute(
                select(func.count(AuditPoint.id)).where(
                    AuditPoint.package_code == svc.code, AuditPoint.code == p.code
                )
            )
            if (existing_pts.scalar() or 0) > 0:
                p.code = f"{p.code[:48]}_r{ext.round_no}"[:64]

            description = p.description or ""
            if p.judgment_rule:
                description = (
                    f"{description}\n\n判断规则：{p.judgment_rule}".strip()
                )
            if p.judgment_basis:
                description = (
                    f"{description}\n\n判断依据：{p.judgment_basis}".strip()
                )

            audit_point = AuditPoint(
                package_code=svc.code,
                item_id=item_id,
                code=p.code,
                label=p.label or p.label_cn,
                label_cn=p.label_cn,
                description=description[:8000] or None,
                medium_threshold=p.medium_threshold,
                high_threshold=p.high_threshold,
                scope_text=p.scope_text,
                risk_level=p.risk_level,
                is_enabled=request.enable_imported,
                sort_order=sort_idx * 10,
            )
            db.add(audit_point)
            await db.flush()
            p.imported_point_id = audit_point.id
            point_id_map[p.id] = audit_point.id

    doc.target_service_code = svc.code
    doc.status = KnowledgeDocumentStatus.IMPORTED
    doc.error_message = None
    await db.flush()

    return KnowledgeImportResult(
        document_id=doc.id,
        extraction_id=ext.id,
        service_code=svc.code,
        imported_items=len(item_id_map),
        imported_points=len(point_id_map),
        item_id_map=item_id_map,
        point_id_map=point_id_map,
    )


def extract_storage_text(
    *, mime_type: str, storage_root_path: Any, storage_key: str
) -> str:
    """Wrapper around text_extractor for the route layer."""
    from pathlib import Path

    full_path = Path(storage_root_path) / "uploads" / storage_key
    return extract_text(mime_type=mime_type, storage_path=full_path)


__all__ = [
    "KnowledgeError",
    "TextExtractionError",
    "create_document",
    "list_documents",
    "get_document",
    "delete_document",
    "get_extraction",
    "get_extraction_full",
    "trigger_extraction",
    "patch_item",
    "patch_point",
    "import_selected",
    "extract_storage_text",
]