"""add rule hierarchy: audit_items + audit_points

Introduces the 3-level rule model:
- Package = existing services row (no rename, just a flag column).
- Item    = audit_items (e.g. 涉政 / 暴恐 / 引流).
- Point   = audit_points (fine-grained detection config).

DetectionRule keeps a nullable audit_point_id bridge for backward compat
with strategy.service_config.rule_overrides[label] readers.

Revision ID: add_rule_hierarchy
Revises: add_review_assignment_tags
Create Date: 2026-07-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "add_rule_hierarchy"
down_revision = "add_review_assignment_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "services",
        sa.Column(
            "is_rule_package",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    op.create_table(
        "audit_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("package_code", sa.String(length=64), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name_cn", sa.String(length=64), nullable=False),
        sa.Column(
            "aliases",
            postgresql.JSONB(astext_type=sa.Text())
            if op.get_bind().dialect.name == "postgresql"
            else sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'") if op.get_bind().dialect.name == "postgresql" else None,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=False),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["package_code"],
            ["services.code"],
            name="fk_audit_item_package",
        ),
        sa.UniqueConstraint("package_code", "code", name="uq_audit_item_pkg_code"),
    )
    op.create_index("ix_audit_items_package_code", "audit_items", ["package_code"])

    op.create_table(
        "audit_points",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("package_code", sa.String(length=64), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("label_cn", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("medium_threshold", sa.Float(), nullable=False, server_default="60.0"),
        sa.Column("high_threshold", sa.Float(), nullable=False, server_default="90.0"),
        sa.Column("scope_text", sa.String(length=255), nullable=True),
        sa.Column(
            "risk_level",
            sa.Enum("低风险", "中风险", "高风险", name="auditpointrisk"),
            nullable=False,
            server_default="中风险",
        ),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("custom_wordset_id", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=False),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["package_code"],
            ["services.code"],
            name="fk_audit_point_package",
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["audit_items.id"],
            name="fk_audit_point_item",
        ),
        sa.ForeignKeyConstraint(
            ["custom_wordset_id"],
            ["word_sets.id"],
            name="fk_audit_point_wordset",
        ),
        sa.UniqueConstraint("package_code", "code", name="uq_audit_point_pkg_code"),
    )
    op.create_index("ix_audit_points_package_code", "audit_points", ["package_code"])
    op.create_index("ix_audit_points_item_id", "audit_points", ["item_id"])

    op.add_column(
        "detection_rules",
        sa.Column(
            "audit_point_id",
            sa.Integer(),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_detection_rules_audit_point_id",
        "detection_rules",
        ["audit_point_id"],
    )
    op.create_foreign_key(
        "fk_detection_rule_audit_point",
        "detection_rules",
        "audit_points",
        ["audit_point_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_detection_rule_audit_point", "detection_rules", type_="foreignkey")
    op.drop_index("ix_detection_rules_audit_point_id", table_name="detection_rules")
    op.drop_column("detection_rules", "audit_point_id")

    op.drop_index("ix_audit_points_item_id", table_name="audit_points")
    op.drop_index("ix_audit_points_package_code", table_name="audit_points")
    op.drop_table("audit_points")
    op.execute("DROP TYPE IF EXISTS auditpointrisk")

    op.drop_index("ix_audit_items_package_code", table_name="audit_items")
    op.drop_table("audit_items")

    op.drop_column("services", "is_rule_package")