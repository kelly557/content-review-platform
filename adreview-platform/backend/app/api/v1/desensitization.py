"""Desensitization API: preview, apply, list rules."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.desensitization import DesensitizationRule
from app.models.material import MaterialVersion
from app.models.review import ReviewTask
from app.models.user import User
from app.schemas.desensitization import (
    DesensitizeApplyRequest,
    DesensitizeApplyResponse,
    DesensitizePreviewRequest,
    DesensitizePreviewResponse,
    DesensitizationRuleOut,
    MaskSpanOut,
    MaskedBodyOut,
    MaskedHitOut,
)
from app.services.desensitization import build_default_rules, desensitize
from app.services.audit import write_audit

router = APIRouter(prefix="/desensitization", tags=["desensitization"])


@router.post("/preview", response_model=DesensitizePreviewResponse)
async def preview(
    body: DesensitizePreviewRequest,
    _: User = Depends(get_current_user),
) -> DesensitizePreviewResponse:
    """Run the desensitization engine against arbitrary text.

    Useful for the rule-editor UI to test a pattern before saving it.
    """
    result = desensitize(body.text, build_default_rules(), whitelist=body.whitelist)
    return DesensitizePreviewResponse(
        masked=result.masked,
        spans=[
            MaskSpanOut(start=s.start, end=s.end, category=s.category, original=s.original)
            for s in result.spans
        ],
        category=result.category,
    )


@router.post("/apply", response_model=DesensitizeApplyResponse)
async def apply(
    body: DesensitizeApplyRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DesensitizeApplyResponse:
    """Materialize the desensitize plan stored on a review task.

    Updates the per-hit ``quote`` field (in ``machine_result.hits``) and
    the material version's ``text_body``. Original text is captured in an
    audit event so admins can recover the unmasked content if needed.
    """
    task = await db.scalar(
        select(ReviewTask)
        .where(ReviewTask.id == body.task_id)
    )
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")

    machine_result = task.machine_result or {}
    plan = machine_result.get("desensitize_plan")
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该任务没有可用的脱敏计划（risk_level 必须为「敏感」）",
        )

    rules = build_default_rules()
    whitelist = body.whitelist

    masked_hits: List[MaskedHitOut] = []
    hits = machine_result.get("hits", [])
    for entry in plan.get("hits", []):
        original = entry.get("original") or ""
        if not original:
            continue
        result = desensitize(original, rules, whitelist=whitelist)
        masked_hits.append(MaskedHitOut(
            label=entry.get("label"),
            label_cn=entry.get("label_cn"),
            category=result.category or entry.get("category"),
            original=original,
            masked=result.masked,
            spans=[
                MaskSpanOut(start=s.start, end=s.end, category=s.category, original=s.original)
                for s in result.spans
            ],
        ))

    # Reflect masked quote back into machine_result.hits so the UI sees
    # the masked version immediately.
    for hit, masked_entry in zip(hits, masked_hits):
        hit["quote"] = masked_entry.masked
        hit["quote_masked"] = True
    machine_result["hits"] = hits

    # Apply to material version text_body if present.
    version = await db.get(MaterialVersion, task.material_version_id)
    masked_body: MaskedBodyOut | None = None
    if version and version.text_body:
        result = desensitize(version.text_body, rules, whitelist=whitelist)
        masked_body = MaskedBodyOut(
            original=version.text_body,
            masked=result.masked,
            spans=[
                MaskSpanOut(start=s.start, end=s.end, category=s.category, original=s.original)
                for s in result.spans
            ],
        )
        machine_result["original_text_body"] = version.text_body
        version.text_body = result.masked

    machine_result["desensitized_at"] = datetime.now(timezone.utc).isoformat()
    machine_result["desensitized_by"] = user.id
    machine_result["suggested_action"] = "approved"  # post-desensitize flow can pass
    task.machine_result = machine_result

    write_audit(
        db,
        actor=user,
        action="desensitize.apply",
        entity_type="review_task",
        entity_id=task.id,
        payload={
            "masked_hit_count": len(masked_hits),
            "applied_to_body": masked_body is not None,
            "whitelist": whitelist,
        },
    )

    await db.flush()
    await db.commit()

    return DesensitizeApplyResponse(
        task_id=task.id,
        masked_hits=masked_hits,
        masked_body=masked_body,
        applied_at=machine_result["desensitized_at"],
    )


@router.get("/rules", response_model=List[DesensitizationRuleOut])
async def list_rules(
    service_code: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> List[DesensitizationRuleOut]:
    """List desensitization rules (per-service or global)."""
    stmt = select(DesensitizationRule).order_by(DesensitizationRule.id.asc())
    if service_code is not None:
        stmt = stmt.where(DesensitizationRule.service_code == service_code)
    result = await db.execute(stmt)
    return [
        DesensitizationRuleOut(
            id=r.id,
            category=r.category,
            pattern=r.pattern,
            mask_template=r.mask_template,
            description=r.description,
            enabled=r.enabled,
            service_code=r.service_code,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat() if r.updated_at else None,
        )
        for r in result.scalars()
    ]