"""rename audit_items.active_large_model_version_id → active_large_model_id

Revision ID: 20260727_rename_lmv
Revises: 20260715_add_root_admin_role
Create Date: 2026-07-27

- 列重命名：active_large_model_version_id → active_large_model_id
- FK 从 registered_model_versions.id 改为 registered_models.id
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260727_rename_lmv"
down_revision = "20260715_add_root_admin_role"
branch_labels = None
depends_on = None

TABLE = "audit_items"
OLD_COL = "active_large_model_version_id"
NEW_COL = "active_large_model_id"
OLD_FK = "fk_audit_items_active_large_model_version"
NEW_FK = "fk_audit_items_active_large_model"


def _column_names(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _fk_names(bind, table: str) -> set[str]:
    return {fk["name"] for fk in sa.inspect(bind).get_foreign_keys(table)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, TABLE)
    fks = _fk_names(bind, TABLE)

    if OLD_COL in cols and NEW_COL not in cols:
        if OLD_FK in fks:
            op.drop_constraint(OLD_FK, TABLE, type_="foreignkey")
        op.alter_column(TABLE, OLD_COL, new_column_name=NEW_COL)
        op.create_foreign_key(
            NEW_FK,
            TABLE,
            "registered_models",
            [NEW_COL],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, TABLE)
    fks = _fk_names(bind, TABLE)

    if NEW_COL in cols and OLD_COL not in cols:
        if NEW_FK in fks:
            op.drop_constraint(NEW_FK, TABLE, type_="foreignkey")
        op.alter_column(TABLE, NEW_COL, new_column_name=OLD_COL)
        op.create_foreign_key(
            OLD_FK,
            TABLE,
            "registered_model_versions",
            [OLD_COL],
            ["id"],
            ondelete="SET NULL",
        )
