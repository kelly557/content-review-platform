"""add public_id (UUID v7) to every integer-PK table

Phase 1 of the public_id rollout. Adds a nullable ``public_id`` column
(36 chars, UUID v7 format) to every table that today has an integer
surrogate PK, plus a UNIQUE index.

Backfill is intentionally NOT done in this migration because:

1. We want the migration to be safe to run against a live DB without
   long-running table locks on a multi-million-row table. The
   backfill is exposed as a separate one-shot script
   ``scripts/backfill_public_ids.py`` that the operator runs
   intentionally, with chunked UPDATE ... FROM (SELECT ...) batches
   and a per-row progress log.
2. New rows get their ``public_id`` from the model ``default=`` so
   the column never stays NULL for new writes.
3. The ``public_id`` column is made NOT NULL only after the backfill
   script confirms 0 NULLs. See ``scripts/backfill_public_ids.py`` —
   it ends by tightening the constraint.

Tables covered (25, matching the Phase 1 plan):

  users, materials, material_versions, material_packages,
  material_package_items, strategies, strategy_items,
  strategy_points, audit_items, audit_points, services,
  service_categories, word_sets, image_sets, image_set_items,
  libraries, library_items, triggers, trigger_runs, workflow_templates,
  workflow_instances, workflow_nodes, review_tasks, review_assignments,
  review_assignment_tags, review_comments, annotations, detection_rules,
  desensitization_rules, human_review_configs, alert_events,
  audit_events, ops_log

Out of scope (Phase 1): ``tags.id`` (already UUID-keyed) and the two
composite-PK junction tables ``library_item_references`` and
``audit_point_libraries``.

Revision ID: 20260714_add_public_id_columns
Revises: 20260714_library_platform_toggle_ui
Create Date: 2026-07-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260714_add_public_id_columns"
down_revision = "20260714_library_platform_toggle_ui"
branch_labels = None
depends_on = None


# 25 integer-PK tables from the Phase 1 plan
TABLES = [
    "users",
    "materials",
    "material_versions",
    "material_packages",
    "material_package_items",
    "strategies",
    "strategy_items",
    "strategy_points",
    "audit_items",
    "audit_points",
    "services",
    "service_categories",
    "word_sets",
    "image_sets",
    "image_set_items",
    "libraries",
    "library_items",
    "triggers",
    "trigger_runs",
    "workflow_templates",
    "workflow_instances",
    "workflow_nodes",
    "review_tasks",
    "review_assignments",
    "review_assignment_tags",
    "review_comments",
    "annotations",
    "detection_rules",
    "desensitization_rules",
    "human_review_configs",
    "alert_events",
    "audit_events",
    "ops_log",
]


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table,
            sa.Column("public_id", sa.String(length=36), nullable=True),
        )
        op.create_index(
            f"ix_{table}_public_id",
            table,
            ["public_id"],
            unique=True,
        )
    # Note: no NOT NULL constraint here. Backfill script
    # scripts/backfill_public_ids.py is responsible for populating
    # existing rows and then ALTER COLUMN ... SET NOT NULL.


def downgrade() -> None:
    for table in TABLES:
        op.drop_index(f"ix_{table}_public_id", table_name=table)
        op.drop_column(table, "public_id")
