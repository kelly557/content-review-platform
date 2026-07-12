"""Admin rule-import router — paths /api/v1/admin/import-rules/*.

Auth: gated by the main product's `require_roles("admin")` dependency.
The standalone /import-rules frontend page calls these endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.rule_import import RuleImportRequest, RuleImportResult
from app.services.rule_importer import import_rules


router = APIRouter(
    prefix="/admin/import-rules",
    tags=["admin-import-rules"],
)


@router.post("/preview", response_model=RuleImportResult)
async def preview(
    body: RuleImportRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_roles("admin")),
) -> RuleImportResult:
    return await import_rules(db, body, dry_run=True)


@router.post("/import", response_model=RuleImportResult)
async def import_endpoint(
    body: RuleImportRequest,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_roles("admin")),
) -> RuleImportResult:
    return await import_rules(db, body, dry_run=False)
