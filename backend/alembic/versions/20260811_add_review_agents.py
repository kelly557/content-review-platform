"""add review_agents + review_agent_versions

审核智能体: 可发布版本的检测 Agent 配置, 支持版本快照与回滚。

Revision ID: 20260811_add_review_agents
Revises: 20260810_add_tenants_api_keys_permissions
Create Date: 2026-08-11
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260811_add_review_agents"
down_revision = "20260810_add_tenants_api_keys_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_agents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(36), nullable=False, unique=True),
        sa.Column("app_id", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("modality", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="未发布"),
        sa.Column(
            "model_id",
            sa.Integer(),
            sa.ForeignKey("registered_models.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("points", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("online_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("draft_saved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_version", sa.String(32), nullable=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_review_agents_public_id", "review_agents", ["public_id"], unique=True)
    op.create_index("ix_review_agents_app_id", "review_agents", ["app_id"], unique=True)
    op.create_index("ix_review_agents_model_id", "review_agents", ["model_id"])

    op.create_table(
        "review_agent_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "agent_id",
            sa.Integer(),
            sa.ForeignKey("review_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="published"),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_review_agent_versions_agent_id", "review_agent_versions", ["agent_id"])


def downgrade() -> None:
    op.drop_index("ix_review_agent_versions_agent_id", table_name="review_agent_versions")
    op.drop_table("review_agent_versions")
    op.drop_index("ix_review_agents_model_id", table_name="review_agents")
    op.drop_index("ix_review_agents_app_id", table_name="review_agents")
    op.drop_index("ix_review_agents_public_id", table_name="review_agents")
    op.drop_table("review_agents")
