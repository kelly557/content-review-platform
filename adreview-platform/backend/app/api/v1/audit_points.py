"""AuditPoint router (审核点 CRUD)."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.audit_item import AuditItem
from app.models.audit_point import AuditPoint
from app.models.service import Service
from app.models.user import User, UserRole
from app.schemas.audit_point import (
    AuditPointBatchCreate,
    AuditPointBatchItem,
    AuditPointBatchResult,
    AuditPointCreate,
    AuditPointOut,
    AuditPointResetResult,
    AuditPointUpdate,
    serialize_audit_point,
)
from app.services.document_parser import extract_text_from_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/packages", tags=["audit-points"])


async def _ensure_package(db: AsyncSession, code: str) -> Service:
    result = await db.execute(select(Service).where(Service.code == code))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="规则包不存在")
    return svc


async def _generate_point_code(db: AsyncSession, package_code: str, item_id: int) -> str:
    """Generate a unique audit point code: ap_{item_id}_{n+1}.

    Concurrent safety: relies on the (package_code, code) UniqueConstraint
    to surface a 409 if two requests race to the same n.
    """
    count_stmt = select(func.count(AuditPoint.id)).where(
        AuditPoint.package_code == package_code,
        AuditPoint.item_id == item_id,
    )
    total = (await db.execute(count_stmt)).scalar_one() or 0
    return f"ap_{item_id}_{total + 1}"


async def _ensure_item_writable(
    db: AsyncSession,
    package_code: str,
    item_id: int,
) -> AuditItem:
    """返回 item 实例，便于调用方读取 is_builtin。

    使用 select + noload 显式关闭 ``linked_libraries`` / ``linked_library_links``
    的 selectin 自动加载，避免在已有 selectin 关系的 item 上做异步 db.get
    引发关联 IO 阻塞。
    """
    from sqlalchemy.orm import noload

    item = (
        await db.execute(
            select(AuditItem)
            .where(AuditItem.id == item_id)
            .options(
                noload(AuditItem.linked_libraries),
                noload(AuditItem.linked_library_links),
            )
        )
    ).scalar_one_or_none()
    if not item or item.package_code != package_code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核项不存在")
    return item


# 内置审核点允许修改的字段白名单。
# 其余字段（如 label_cn / description / scope_text / risk_level / custom_wordset_id /
# sort_order）由下列 _filter_payload_for_builtin_point 函数在 router 层拦截；
# 即便绕过前端直接请求，也兜底 422。
BUILTIN_POINT_WRITABLE_FIELDS = frozenset(
    {"is_enabled", "medium_threshold", "high_threshold"}
)


def _filter_payload_for_builtin_point(
    point: AuditPoint, body: AuditPointUpdate, user: User
) -> None:
    """对「内置审核点」的更新请求拦截非白名单字段。

    超级管理员不受白名单限制,可任意修改通用审核点的任意字段。
    """
    if not point.is_builtin:
        return
    if user.role in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN):
        return
    # Pydantic v2: model_fields_set 记录显式提供字段（含 null）
    fields_set = getattr(body, "model_fields_set", set())
    blocked = sorted(k for k in fields_set if k not in BUILTIN_POINT_WRITABLE_FIELDS)
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "通用审核点不允许修改字段："
                + "、".join(blocked)
                + "；仅允许启用 / 中/高风险分（超级管理员可改任意字段）。"
            ),
        )


async def _replace_linked_libraries(
    db: AsyncSession,
    point: AuditPoint,
    library_ids: Optional[list[int]],
) -> None:
    """DEPRECATED — 关联自定义库已上移至审核项。

    保留函数用于向后兼容旧的 admin_import_rules 接口；路由层不再调用本函数。
    """
    return None


@router.get("/{code}/points", response_model=list[AuditPointOut])
async def list_points(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    item_id: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> list[AuditPointOut]:
    from sqlalchemy.orm import selectinload

    await _ensure_package(db, code)
    stmt = (
        select(AuditPoint)
        .where(AuditPoint.package_code == code)
        .options(
            selectinload(AuditPoint.linked_library_links),
            selectinload(AuditPoint.linked_libraries),
        )
    )
    if item_id is not None:
        stmt = stmt.where(AuditPoint.item_id == item_id)
    if enabled is not None:
        stmt = stmt.where(AuditPoint.is_enabled.is_(enabled))
    stmt = stmt.order_by(AuditPoint.item_id.asc(), AuditPoint.sort_order.asc(), AuditPoint.id.asc())
    rows = list((await db.execute(stmt)).scalars())
    return [AuditPointOut.model_validate(serialize_audit_point(r)) for r in rows]


@router.post("/{code}/points", response_model=AuditPointOut, status_code=status.HTTP_201_CREATED)
async def create_point(
    code: str,
    body: AuditPointCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointOut:
    await _ensure_package(db, code)
    item = await _ensure_item_writable(db, code, body.item_id)
    # 通用审核项下:仅超级管理员可新增审核点;其他角色需新建个性化 item
    if item.is_builtin and current_user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项下不允许新增审核点；如需扩展，请在资源库新建个性化审核项，或由超级管理员操作。",
        )
    generated_code = await _generate_point_code(db, code, body.item_id)
    point = AuditPoint(
        package_code=code,
        item_id=body.item_id,
        code=generated_code,
        label=generated_code,
        label_cn=body.label_cn,
        description=body.description,
        medium_threshold=body.medium_threshold,
        high_threshold=body.high_threshold,
        scope_text=body.scope_text,
        risk_level=body.risk_level,
        is_enabled=body.is_enabled,
        custom_wordset_id=body.custom_wordset_id,
        sort_order=body.sort_order,
    )
    db.add(point)
    try:
        await db.flush()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="审核点编码生成冲突，请重试",
        )
    # 「关联自定义图库词库」已上移至审核项；此处不再处理 linked_library_ids。
    await db.refresh(point)
    await db.commit()
    return AuditPointOut.model_validate(serialize_audit_point(point))


@router.put("/{code}/points/{point_id}", response_model=AuditPointOut)
async def update_point(
    code: str,
    point_id: int,
    body: AuditPointUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointOut:
    await _ensure_package(db, code)
    point = await db.get(AuditPoint, point_id)
    if not point or point.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核点不存在")
    _filter_payload_for_builtin_point(point, body, current_user)
    if body.label_cn is not None:
        point.label_cn = body.label_cn
    if body.description is not None:
        point.description = body.description
    if body.medium_threshold is not None:
        point.medium_threshold = body.medium_threshold
    if body.high_threshold is not None:
        point.high_threshold = body.high_threshold
    if body.scope_text is not None:
        point.scope_text = body.scope_text
    if body.risk_level is not None:
        point.risk_level = body.risk_level
    if body.is_enabled is not None:
        point.is_enabled = body.is_enabled
    if body.custom_wordset_id is not None:
        # 旧列：写入但不进新表；log 一次提示
        logger.warning(
            "audit_point(%s) custom_wordset_id being written via legacy field; "
            "consider migrating to item-level linked_library_ids",
            point.id,
        )
        point.custom_wordset_id = body.custom_wordset_id
    if body.sort_order is not None:
        point.sort_order = body.sort_order
    await db.flush()
    await db.refresh(point)
    await db.commit()
    return AuditPointOut.model_validate(serialize_audit_point(point))


@router.delete("/{code}/points/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_point(
    code: str,
    point_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> None:
    await _ensure_package(db, code)
    point = await db.get(AuditPoint, point_id)
    if not point or point.package_code != code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="审核点不存在")
    if point.is_builtin and current_user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核点不允许删除;仅超级管理员可操作。",
        )
    await db.delete(point)
    await db.commit()


@router.post("/{code}/points/reset", response_model=AuditPointResetResult)
async def reset_points(
    code: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointResetResult:
    from sqlalchemy.orm import selectinload

    await _ensure_package(db, code)
    stmt = (
        select(AuditPoint)
        .where(AuditPoint.package_code == code)
        .options(
            selectinload(AuditPoint.linked_library_links),
            selectinload(AuditPoint.linked_libraries),
        )
    )
    rows = list((await db.execute(stmt)).scalars())
    for p in rows:
        p.medium_threshold = 60.0
        p.high_threshold = 90.0
    await db.flush()
    await db.commit()
    return AuditPointResetResult(
        items=[AuditPointOut.model_validate(serialize_audit_point(p)) for p in rows]
    )


@router.post("/{code}/points/batch", response_model=AuditPointBatchResult)
async def create_points_batch(
    code: str,
    body: AuditPointBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "superadmin")),
) -> AuditPointBatchResult:
    await _ensure_package(db, code)
    item = await _ensure_item_writable(db, code, body.item_id)
    # 通用审核项下:仅超级管理员可批量新增审核点;其他角色需新建个性化 item
    if item.is_builtin and current_user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="通用审核项下不允许批量新增审核点；请新建个性化审核项，或由超级管理员操作。",
        )

    items: list[AuditPointBatchItem] = []
    succeeded = 0
    for idx, raw in enumerate(body.points):
        forced = raw.model_copy(update={"item_id": body.item_id})
        try:
            payload = AuditPointCreate.model_validate(forced)
        except ValidationError as ve:
            msg = ve.errors()[0].get("msg", "校验失败") if ve.errors() else "校验失败"
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=raw.label_cn,
                    status="error",
                    error=msg,
                )
            )
            continue

        try:
            generated = await _generate_point_code(db, code, body.item_id)
            point = AuditPoint(
                package_code=code,
                item_id=body.item_id,
                code=generated,
                label=generated,
                label_cn=payload.label_cn,
                description=payload.description,
                medium_threshold=payload.medium_threshold,
                high_threshold=payload.high_threshold,
                scope_text=payload.scope_text,
                risk_level=payload.risk_level,
                is_enabled=payload.is_enabled,
                custom_wordset_id=payload.custom_wordset_id,
                sort_order=payload.sort_order,
            )
            db.add(point)
            await db.flush()
            # 「关联自定义图库词库」已上移至审核项；批量创建不再处理 linked_library_ids。
            await db.refresh(point)
            await db.commit()
            serialized = serialize_audit_point(point)
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=payload.label_cn,
                    status="ok",
                    point=AuditPointOut.model_validate(serialized),
                )
            )
            succeeded += 1
        except IntegrityError:
            await db.rollback()
            items.append(
                AuditPointBatchItem(
                    index=idx,
                    label_cn=payload.label_cn,
                    status="error",
                    error="编码冲突，请重试",
                )
            )

    return AuditPointBatchResult(
        succeeded=succeeded,
        failed=len(body.points) - succeeded,
        items=items,
    )


# ─────────────── Document parsing ───────────────


ALLOWED_DOC_EXT = {".pdf", ".txt", ".md", ".doc", ".docx"}
MAX_DOC_BYTES = 20 * 1024 * 1024


class ParsedAuditPoint(BaseModel):
    label_cn: str
    scope_text: str = ""


class DocumentParseResult(BaseModel):
    points: list[ParsedAuditPoint]
    source_info: str = ""


@router.post("/points/parse-document", response_model=DocumentParseResult)
async def parse_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Parse a document (PDF/DOC/DOCX/TXT) into audit points using AI.

    The document text is extracted and then parsed by the LLM to identify
    audit points. This allows users to upload legal regulations, industry
    standards, or other reference documents and have them automatically
    converted into structured audit points.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")

    from pathlib import Path

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_DOC_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}，仅支持 {', '.join(ALLOWED_DOC_EXT)}",
        )

    content = await file.read()
    if len(content) > MAX_DOC_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"文件超过 {MAX_DOC_BYTES // 1024 // 1024}MB 上限",
        )

    try:
        text = extract_text_from_file(content, file.filename)
    except Exception as e:
        logger.error("Failed to extract text from %s: %s", file.filename, e)
        raise HTTPException(status_code=400, detail=f"文件解析失败: {e}")

    if not text.strip():
        raise HTTPException(status_code=400, detail="文件内容为空")

    # Use LLM to parse audit points from the document text
    try:
        from app.services.llm.client import get_llm_client

        llm = get_llm_client()
        prompt = f"""请从以下文档内容中提取审核点。每个审核点包含：
- label_cn: 审核点名称（简短描述要审核的内容）
- scope_text: 审核内容描述（具体的审核标准或判断依据）

请以 JSON 数组格式返回，每个元素包含 label_cn 和 scope_text 字段。
如果无法提取到有效的审核点，返回空数组 []。

文档内容：
{text[:10000]}
"""
        response = await llm.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
        )

        import json
        import re

        # Try to extract JSON from the response
        json_match = re.search(r"\[[\s\S]*\]", response)
        if json_match:
            raw_points = json.loads(json_match.group())
        else:
            raw_points = json.loads(response)

        points = []
        for item in raw_points:
            if isinstance(item, dict) and "label_cn" in item:
                points.append(
                    ParsedAuditPoint(
                        label_cn=str(item.get("label_cn", "")),
                        scope_text=str(item.get("scope_text", "")),
                    )
                )

        return DocumentParseResult(
            points=points,
            source_info=f"从 {file.filename} 解析",
        )

    except Exception as e:
        logger.error("LLM parsing failed for %s: %s", file.filename, e)
        # Return empty result instead of error, so user can manually input
        return DocumentParseResult(
            points=[],
            source_info=f"AI 解析失败，请手动输入。错误: {e}",
        )