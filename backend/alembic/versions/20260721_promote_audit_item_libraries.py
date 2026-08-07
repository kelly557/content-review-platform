"""promote audit_point_libraries to audit_item_libraries

New table ``audit_item_libraries`` (N:M join between audit_items and libraries)
replaces the legacy ``audit_point_libraries``. Existing rows are backfilled by
promoting each ``audit_point_id → library_id`` row to its parent ``audit_item_id``
(distinct on (item_id, library_id), keeping the smallest sort_order). The legacy
table is preserved read-only for the existing API surfaces.

Revision ID: 20260721_promote_audit_item_libraries
Revises: 20260720_knowledge_minimize_fields
Create Date: 2026-07-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260721_promote_audit_item_libraries"
down_revision = "20260720_knowledge_minimize_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("audit_item_libraries"):
        op.create_table(
            "audit_item_libraries",
            sa.Column("audit_item_id", sa.Integer(), primary_key=True),
            sa.Column("library_id", sa.Integer(), primary_key=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=False),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKey(
                "audit_items.id",
                ondelete="CASCADE",
                name="fk_audit_item_libraries_item",
            ),
            sa.ForeignKey(
                "libraries.id",
                ondelete="CASCADE",
                name="fk_audit_item_libraries_library",
            ),
        )
        op.create_index(
            "ix_audit_item_libraries_lib",
            "audit_item_libraries",
            ["library_id"],
        )

    if insp.has_table("audit_point_libraries"):
        # backfill: promote each distinct (item_id, library_id) to the new table.
        bind.execute(
            sa.text(
                """
                INSERT INTO audit_item_libraries (audit_item_id, library_id, sort_order, created_at)
                SELECT ap.item_id AS audit_item_id,
                       apl.library_id AS library_id,
                       MIN(apl.sort_order) AS sort_order,
                       MIN(apl.created_at) AS created_at
                FROM audit_point_libraries apl
                JOIN audit_points ap ON ap.id = apl.audit_point_id
                GROUP BY ap.item_id, apl.library_id
                ON CONFLICT (audit_item_id, library_id) DO NOTHING
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table("audit_item_libraries"):
        op.drop_index(
            "ix_audit_item_libraries_lib",
            table_name="audit_item_libraries",
        )
        op.drop_table("audit_item_libraries")
