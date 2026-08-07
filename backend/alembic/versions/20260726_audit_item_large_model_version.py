"""audit_items: 新增 active_large_model_version_id

个性化规则「生效大模型版本」指针：仅 is_builtin=false 时写入；
指向 kind='large' 的 RegisteredModelVersion（LLM，作为 prompt 执行器）。

通用规则继续使用 active_small_model_version_id（小分类器），两者互不冲突，
新列独立存在于 audit_items。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260726_audit_item_large_model_version"
down_revision = "20260725_rename_audit_item_to_small_model"
branch_labels = None
depends_on = None


def _column_names(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _fk_names(bind, table: str) -> set[str]:
    return {fk["name"] for fk in sa.inspect(bind).get_foreign_keys(table)}


FK_NAME = "fk_audit_items_active_large_model_version"
COL_NAME = "active_large_model_version_id"


def upgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, "audit_items")
    fks = _fk_names(bind, "audit_items")

    if COL_NAME not in cols:
        op.add_column(
            "audit_items",
            sa.Column(COL_NAME, sa.BigInteger(), nullable=True),
        )

    if FK_NAME not in fks:
        op.create_foreign_key(
            FK_NAME,
            "audit_items",
            "registered_model_versions",
            [COL_NAME],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, "audit_items")
    fks = _fk_names(bind, "audit_items")

    if FK_NAME in fks:
        op.drop_constraint(FK_NAME, "audit_items", type_="foreignkey")

    if COL_NAME in cols:
        op.drop_column("audit_items", COL_NAME)