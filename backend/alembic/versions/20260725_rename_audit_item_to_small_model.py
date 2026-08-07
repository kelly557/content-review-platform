"""rename audit_items.active_large_model_version_id → active_small_model_version_id

通用规则「生效模型版本」从大模型改为小模型：
- 列重命名：audit_items.active_large_model_version_id → active_small_model_version_id
- FK 重命名：fk_audit_items_active_large_model_version → fk_audit_items_active_small_model_version

历史数据：之前已绑定的「生效大模型版本」在改名后变成「小模型版本号」语义错误；
若该版本恰好是 large kind 则在「切换版本」时会被后端 _validate_active_model_version
的 kind='small' 校验拒绝，此时界面会自动要求重新选择。本迁移不做数据清理。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260725_rename_audit_item_to_small_model"
down_revision = "20260724_small_model_modality"
branch_labels = None
depends_on = None


def _column_names(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _fk_names(bind, table: str) -> set[str]:
    return {fk["name"] for fk in sa.inspect(bind).get_foreign_keys(table)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, "audit_items")
    fks = _fk_names(bind, "audit_items")

    if "active_large_model_version_id" in cols:
        if "active_small_model_version_id" in cols:
            op.drop_column("audit_items", "active_small_model_version_id")

        if "fk_audit_items_active_large_model_version" in fks:
            op.drop_constraint(
                "fk_audit_items_active_large_model_version",
                "audit_items",
                type_="foreignkey",
            )

        op.alter_column(
            "audit_items",
            "active_large_model_version_id",
            new_column_name="active_small_model_version_id",
        )

        op.create_foreign_key(
            "fk_audit_items_active_small_model_version",
            "audit_items",
            "registered_model_versions",
            ["active_small_model_version_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    cols = _column_names(bind, "audit_items")
    fks = _fk_names(bind, "audit_items")

    if "active_small_model_version_id" in cols:
        if "fk_audit_items_active_small_model_version" in fks:
            op.drop_constraint(
                "fk_audit_items_active_small_model_version",
                "audit_items",
                type_="foreignkey",
            )

        op.alter_column(
            "audit_items",
            "active_small_model_version_id",
            new_column_name="active_large_model_version_id",
        )

        op.create_foreign_key(
            "fk_audit_items_active_large_model_version",
            "audit_items",
            "registered_model_versions",
            ["active_large_model_version_id"],
            ["id"],
            ondelete="SET NULL",
        )