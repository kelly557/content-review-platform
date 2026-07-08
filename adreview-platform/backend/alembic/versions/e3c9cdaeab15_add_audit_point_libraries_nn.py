"""add audit_point_libraries nn

Many-to-many link between audit_points and libraries. Each audit point can
be associated with 1..N libraries of a single library_type (互斥约束由应用
层校验). The legacy 1:1 FK columns (custom_wordset_id, custom_library_id,
custom_reply_library_id) are kept for backward compatibility but不再写入.

Revision ID: e3c9cdaeab15
Revises: add_audit_point_reply_library
Create Date: 2026-07-08 09:33:05.722738
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e3c9cdaeab15"
down_revision: Union[str, Sequence[str], None] = "add_audit_point_reply_library"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: create the new join table only (data backfill is
    done via scripts/backfill_audit_point_libraries.py)."""
    op.create_table(
        "audit_point_libraries",
        sa.Column(
            "audit_point_id",
            sa.Integer(),
            sa.ForeignKey("audit_points.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "library_id",
            sa.Integer(),
            sa.ForeignKey("libraries.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_audit_point_libraries_lib",
        "audit_point_libraries",
        ["library_id"],
    )


def downgrade() -> None:
    """Downgrade schema: drop the join table."""
    op.drop_index("ix_audit_point_libraries_lib", table_name="audit_point_libraries")
    op.drop_table("audit_point_libraries")
