"""Schemas for the admin rule-import endpoints under /admin/import-rules/*.

Auth uses the main product's JWT + require_roles("admin"). No bespoke token.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.audit_point import AuditPointRisk

# Only text + image are exposed by this tool today. audio / document /
# video can be added by extending this Literal + the MEDIA_TO_SERVICE_CODE
# map in app.services.rule_importer.
MediaType = Literal["text", "image"]


class RuleImportRequest(BaseModel):
    """Body for both preview and import endpoints."""

    model_config = ConfigDict(extra="forbid")

    media_type: MediaType
    table_text: str = Field(min_length=1)
    # Which bucket the new rows land in:
    #   "builtin"  → 通用规则,  is_builtin = true
    #   "personal" → 个性化规则, is_builtin = false (legacy default)
    kind: Literal["builtin", "personal"] = "personal"
    is_enabled: bool = False
    on_conflict: Literal["update", "skip"] = "update"

    # When the on-disk row already has a different is_builtin than `kind`:
    #   * upgrading personal → builtin: silent (always allowed)
    #   * downgrading builtin → personal: requires confirm_downgrade=true.
    #     If omitted / false, server rejects with 422.
    confirm_downgrade: bool = False

    # High-level field overrides — apply to every point written by the request.
    default_medium_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    default_high_threshold: Optional[float] = Field(default=None, ge=50.0, le=100.0)
    default_risk_level: Optional[AuditPointRisk] = None


class RuleImportChange(BaseModel):
    entity: Literal["item", "point"]
    code: str
    item_code: Optional[str] = None
    label_cn: str
    description: Optional[str] = None
    action: Literal["create", "update", "skip"]
    id: Optional[int] = None


class RuleImportSummary(BaseModel):
    items_created: int = 0
    items_updated: int = 0
    items_skipped: int = 0
    points_created: int = 0
    points_updated: int = 0
    points_skipped: int = 0


class RuleImportResult(BaseModel):
    package_code: str
    summary: RuleImportSummary
    changes: list[RuleImportChange] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
