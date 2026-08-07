"""merge audit_item fields: active_large_model_version_id + knowledge_document_ids

两个 head（20260721_promote_audit_item_libraries / 20260722_model_kind_and_categories）
合并后追加 audit_items 表的两列：

- ``active_large_model_version_id``: BigInteger NULL, FK → registered_model_versions.id
  (ondelete=SET NULL)。仅通用规则（is_builtin=true）使用，前端「切换生效版本」
  写该字段。
- ``knowledge_document_ids``: JSONB NULL/[], 仅个性化规则（is_builtin=false）
  使用，前端「关联知识文档」多选写该字段。

Revision ID: 20260722_audit_item_model_and_docs
Revises: 20260721_promote_audit_item_libraries, 20260722_model_kind_and_categories
Create Date: 2026-07-22
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "20260722_audit_item_model_and_docs"
down_revision = (
    "20260721_promote_audit_item_libraries",
    "20260722_model_kind_and_categories",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_column("audit_items", "active_large_model_version_id"):
        op.add_column(
            "audit_items",
            sa.Column(
                "active_large_model_version_id",
                sa.BigInteger(),
                nullable=True,
            ),
        )
        op.create_foreign_key(
            "fk_audit_items_active_large_model_version",
            "audit_items",
            "registered_model_versions",
            ["active_large_model_version_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not insp.has_column("audit_items", "knowledge_document_ids"):
        op.add_column(
            "audit_items",
            sa.Column(
                "knowledge_document_ids",
                JSONB,
                nullable=True,
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_column("audit_items", "knowledge_document_ids"):
        op.drop_column("audit_items", "knowledge_document_ids")

    if insp.has_column("audit_items", "active_large_model_version_id"):
        op.drop_constraint(
            "fk_audit_items_active_large_model_version",
            "audit_items",
            type_="foreignkey",
        )
        op.drop_column("audit_items", "active_large_model_version_id")