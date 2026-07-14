"""add provider/model columns to registered_models & registered_model_versions

Refactor: model registry now uses provider + model fields instead of a generic
``registration_method`` enum on the UI. The ``registration_method`` column is
left in place (always 'remote_api' going forward) for audit compatibility.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260719_add_model_provider_field"
down_revision = "20260718_add_resources_knowledge_models"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "registered_models",
        sa.Column("model", sa.String(length=128), nullable=True),
    )
    op.create_index(
        "ix_registered_models_model",
        "registered_models",
        ["model"],
    )
    op.add_column(
        "registered_model_versions",
        sa.Column("provider", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "registered_model_versions",
        sa.Column("model", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registered_model_versions", "model")
    op.drop_column("registered_model_versions", "provider")
    op.drop_index("ix_registered_models_model", table_name="registered_models")
    op.drop_column("registered_models", "model")
