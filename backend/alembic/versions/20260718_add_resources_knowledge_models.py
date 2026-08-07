"""add knowledge_documents, registered_models, resource_credentials

Phase 2+4 of the 资源库 + 模型库 rollout.

- knowledge_documents (主表) + knowledge_document_versions (版本表)
- registered_models (主表) + registered_model_versions (版本表)
- resource_credentials (加密凭证表)

独立的 ORM schema,不影响 libraries / library_items 现有数据。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "20260718_add_resources_knowledge_models"
down_revision = "20260713_extend_audit_point_risk_sensitive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── Policy knowledge base ───
    op.create_table(
        "knowledge_documents",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False, unique=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("document_type", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("issuing_authority", sa.String(length=255), nullable=True),
        sa.Column("document_number", sa.String(length=128), nullable=True),
        sa.Column("jurisdiction", sa.String(length=128), nullable=True),
        sa.Column("industry_tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("policy_tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("source_type", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("current_version_id", sa.BigInteger(), nullable=True),
        sa.Column("owner_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_id", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
    )
    op.create_index("ix_knowledge_documents_public_id", "knowledge_documents", ["public_id"], unique=True)
    op.create_index("ix_knowledge_documents_code", "knowledge_documents", ["code"], unique=True)
    op.create_index("ix_knowledge_documents_document_type", "knowledge_documents", ["document_type"])
    op.create_index("ix_knowledge_documents_status", "knowledge_documents", ["status"])
    op.create_index("ix_knowledge_documents_effective_from", "knowledge_documents", ["effective_from"])
    op.create_index("ix_knowledge_documents_is_deleted", "knowledge_documents", ["is_deleted"])
    op.create_index(
        "ix_knowledge_documents_status_type",
        "knowledge_documents",
        ["status", "document_type"],
    )

    op.create_table(
        "knowledge_document_versions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False, unique=True),
        sa.Column("document_id", sa.BigInteger(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("metadata", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("document_id", "version_no", name="uq_knowledge_doc_version"),
    )
    op.create_index(
        "ix_knowledge_document_versions_public_id",
        "knowledge_document_versions",
        ["public_id"],
        unique=True,
    )
    op.create_index(
        "ix_knowledge_document_versions_document_id",
        "knowledge_document_versions",
        ["document_id"],
    )

    # ─── Resource credentials (shared with model registry) ───
    op.create_table(
        "resource_credentials",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False, unique=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=128), nullable=True),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("masked_token", sa.String(length=64), nullable=False),
        sa.Column("metadata", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by_id", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_resource_credentials_public_id", "resource_credentials", ["public_id"], unique=True)
    op.create_index("ix_resource_credentials_is_deleted", "resource_credentials", ["is_deleted"])

    # ─── Model registry ───
    op.create_table(
        "registered_models",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False, unique=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("modalities", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("scale_class", sa.String(length=8), nullable=False),
        sa.Column("provider", sa.String(length=128), nullable=True),
        sa.Column("registration_method", sa.String(length=16), nullable=False, server_default="remote_api"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("version", sa.String(length=64), nullable=True),
        sa.Column("framework", sa.String(length=64), nullable=True),
        sa.Column("license", sa.String(length=128), nullable=True),
        sa.Column("endpoint_url", sa.Text(), nullable=True),
        sa.Column("config", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("capabilities", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("credential_id", sa.BigInteger(), nullable=True),
        sa.Column("current_version_id", sa.BigInteger(), nullable=True),
        sa.Column("owner_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_id", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
    )
    op.create_index("ix_registered_models_public_id", "registered_models", ["public_id"], unique=True)
    op.create_index("ix_registered_models_code", "registered_models", ["code"], unique=True)
    op.create_index("ix_registered_models_scale_class", "registered_models", ["scale_class"])
    op.create_index("ix_registered_models_status", "registered_models", ["status"])
    op.create_index("ix_registered_models_is_deleted", "registered_models", ["is_deleted"])
    op.create_index(
        "ix_registered_models_status_scale",
        "registered_models",
        ["status", "scale_class"],
    )

    op.create_table(
        "registered_model_versions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("public_id", sa.String(length=36), nullable=False, unique=True),
        sa.Column("model_id", sa.BigInteger(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("registration_method", sa.String(length=16), nullable=False),
        sa.Column("endpoint_url", sa.Text(), nullable=True),
        sa.Column("config", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("capabilities", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("artifact_storage_key", sa.String(length=512), nullable=True),
        sa.Column("artifact_filename", sa.String(length=255), nullable=True),
        sa.Column("artifact_mime_type", sa.String(length=120), nullable=True),
        sa.Column("artifact_size", sa.BigInteger(), nullable=True),
        sa.Column("artifact_sha256", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("validation_log", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_by_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("model_id", "version_no", name="uq_registered_model_version"),
    )
    op.create_index(
        "ix_registered_model_versions_public_id",
        "registered_model_versions",
        ["public_id"],
        unique=True,
    )
    op.create_index(
        "ix_registered_model_versions_model_id",
        "registered_model_versions",
        ["model_id"],
    )

    # ─── Foreign keys with SET NULL semantics (mirror the ORM use_alter) ───
    op.create_foreign_key(
        "fk_knowledge_documents_current_version",
        "knowledge_documents",
        "knowledge_document_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
        use_alter=True,
    )
    op.create_foreign_key(
        "fk_knowledge_document_versions_document",
        "knowledge_document_versions",
        "knowledge_documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_registered_models_credential",
        "registered_models",
        "resource_credentials",
        ["credential_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_registered_models_current_version",
        "registered_models",
        "registered_model_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
        use_alter=True,
    )
    op.create_foreign_key(
        "fk_registered_model_versions_model",
        "registered_model_versions",
        "registered_models",
        ["model_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_registered_model_versions_model", "registered_model_versions", type_="foreignkey")
    op.drop_constraint("fk_registered_models_current_version", "registered_models", type_="foreignkey")
    op.drop_constraint("fk_registered_models_credential", "registered_models", type_="foreignkey")
    op.drop_table("registered_model_versions")
    op.drop_table("registered_models")
    op.drop_table("resource_credentials")
    op.drop_constraint("fk_knowledge_document_versions_document", "knowledge_document_versions", type_="foreignkey")
    op.drop_constraint("fk_knowledge_documents_current_version", "knowledge_documents", type_="foreignkey")
    op.drop_table("knowledge_document_versions")
    op.drop_table("knowledge_documents")
