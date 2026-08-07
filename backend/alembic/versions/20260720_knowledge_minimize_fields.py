"""Minimize knowledge_documents schema — content-safety review knowledge base.

Drops the legacy policy-centric fields and collapses the two tag arrays
into a single ``tags`` column. Renames ``published_at`` -> ``issued_at``.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "20260720_knowledge_minimize_fields"
down_revision = "20260719_add_model_provider_field"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 新增 tags / issued_at
    op.add_column(
        "knowledge_documents",
        sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 2) 数据迁移：industry_tags || policy_tags 去重 -> tags
    op.execute(
        sa.text(
            """
            UPDATE knowledge_documents
            SET tags = COALESCE(
                (
                    SELECT jsonb_agg(DISTINCT value)
                    FROM (
                        SELECT jsonb_array_elements_text(industry_tags) AS value
                        UNION
                        SELECT jsonb_array_elements_text(policy_tags) AS value
                    ) AS t
                ),
                '[]'::jsonb
            )
            """
        )
    )

    # 3) 数据迁移：published_at -> issued_at（如果 issued_at 仍为空）
    op.execute(
        sa.text(
            "UPDATE knowledge_documents SET issued_at = published_at "
            "WHERE issued_at IS NULL AND published_at IS NOT NULL"
        )
    )

    # 4) DROP 老列 + 老索引
    op.drop_index("ix_knowledge_documents_status_type", table_name="knowledge_documents")
    op.drop_index("ix_knowledge_documents_effective_from", table_name="knowledge_documents")
    op.drop_index("ix_knowledge_documents_document_type", table_name="knowledge_documents")

    op.drop_column("knowledge_documents", "document_type")
    op.drop_column("knowledge_documents", "issuing_authority")
    op.drop_column("knowledge_documents", "document_number")
    op.drop_column("knowledge_documents", "jurisdiction")
    op.drop_column("knowledge_documents", "industry_tags")
    op.drop_column("knowledge_documents", "policy_tags")
    op.drop_column("knowledge_documents", "published_at")
    op.drop_column("knowledge_documents", "effective_from")
    op.drop_column("knowledge_documents", "effective_until")


def downgrade() -> None:
    op.add_column(
        "knowledge_documents",
        sa.Column("effective_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("policy_tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("industry_tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("jurisdiction", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("document_number", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("issuing_authority", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("document_type", sa.String(length=32), nullable=False, server_default="other"),
    )

    op.create_index(
        "ix_knowledge_documents_document_type",
        "knowledge_documents",
        ["document_type"],
    )
    op.create_index(
        "ix_knowledge_documents_effective_from",
        "knowledge_documents",
        ["effective_from"],
    )
    op.create_index(
        "ix_knowledge_documents_status_type",
        "knowledge_documents",
        ["status", "document_type"],
    )

    op.drop_column("knowledge_documents", "issued_at")
    op.drop_column("knowledge_documents", "tags")
