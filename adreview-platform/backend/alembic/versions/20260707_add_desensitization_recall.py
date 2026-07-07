"""add desensitization_rules + human_review_configs.recall_mode

Two changes in one revision because they ship together:

1. New table ``desensitization_rules`` — per-(tenant, service) mask pattern
   used by the AI-review desensitization engine (id_card / phone /
   bank_card / email / address / custom).
2. New boolean column ``recall_mode`` on ``human_review_configs`` — when
   ``True``, low/中/敏感 risk levels also escalate to human review even
   when not explicitly listed in ``risk_levels``.

Revision ID: 20260707_add_desensitization_recall
Revises: add_library_reply_type
Create Date: 2026-07-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260707_add_desensitization_recall"
down_revision = "add_library_reply_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "desensitization_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("pattern", sa.Text(), nullable=False),
        sa.Column("mask_template", sa.String(length=64), nullable=False, server_default="****"),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("service_code", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=False),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["service_code"], ["services.code"], name="fk_desens_rules_service_code"
        ),
    )
    op.create_index(
        "ix_desensitization_rules_category", "desensitization_rules", ["category"]
    )
    op.create_index(
        "ix_desensitization_rules_service_code",
        "desensitization_rules",
        ["service_code"],
    )

    op.add_column(
        "human_review_configs",
        sa.Column("recall_mode", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("human_review_configs", "recall_mode")
    op.drop_index("ix_desensitization_rules_service_code", "desensitization_rules")
    op.drop_index("ix_desensitization_rules_category", "desensitization_rules")
    op.drop_table("desensitization_rules")