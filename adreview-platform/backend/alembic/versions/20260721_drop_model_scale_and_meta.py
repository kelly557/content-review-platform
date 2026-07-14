"""minimize model fields: drop scale_class / framework / license / capabilities

Refactor: model registry is a single-tier LLM catalog (no LLM/SLM distinction),
no per-model framework/license/capability. The schema and API only retain fields
that drive review calling or audit: name, description, provider, model_id,
endpoint_url, credential_id, modalities, version, status.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260721_drop_model_scale_and_meta"
down_revision = "20260720_knowledge_minimize_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 删索引（status_scale）
    op.drop_index("ix_registered_models_status_scale", table_name="registered_models")

    op.drop_column("registered_models", "scale_class")
    op.drop_column("registered_models", "framework")
    op.drop_column("registered_models", "license")
    op.drop_column("registered_models", "capabilities")
    op.drop_column("registered_model_versions", "capabilities")


def downgrade() -> None:
    op.add_column(
        "registered_model_versions",
        sa.Column(
            "capabilities",
            sa.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "registered_models",
        sa.Column(
            "capabilities",
            sa.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "registered_models",
        sa.Column("license", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "registered_models",
        sa.Column("framework", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "registered_models",
        sa.Column("scale_class", sa.String(length=8), nullable=False, server_default="large"),
    )
    op.create_index(
        "ix_registered_models_status_scale",
        "registered_models",
        ["status", "scale_class"],
    )
