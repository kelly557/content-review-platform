"""add page_guide table

Prototype-guide content for frontend routes, now persisted server-side
instead of being only localStorage. Each row is the user-customized
override of one route's prototype guide Markdown; the frontend
``pageGuides.tsx`` constant table still acts as the development-time
fallback for routes that have no override yet.

Schema
------

- ``path`` is the frontend route key (e.g. ``/strategies/:id/edit``);
  serves as the primary key and is the lookup key from the API.
- ``title`` is the Drawer title shown in the UI.
- ``markdown_md`` is the full-page Markdown blob the editor saves.
  Granularity of a save is the whole page (matches the frontend
  ``sectionsToDraft`` shape).
- ``updated_by_id`` references ``user.id`` with ``ON DELETE SET NULL``
  so deleting a user does not cascade-wipe guide content.
- ``created_at`` / ``updated_at`` server-side timestamps; the latter is
  indexed for the list endpoint's ``ORDER BY updated_at DESC``.

No seed data is inserted here on purpose — rows are created lazily by
the first user edit. This is consistent with the project rule that
prototype-guide content is owned by the user, not the application.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260723_add_page_guide"
down_revision = "20260720_add_uploaded_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "page_guide",
        sa.Column("path", sa.String(length=255), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("markdown_md", sa.Text(), nullable=False),
        sa.Column(
            "updated_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_page_guide_updated_at", "page_guide", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_page_guide_updated_at", table_name="page_guide")
    op.drop_table("page_guide")
