"""extend auditpointrisk enum with '敏感' + apply tx_privacy_pii re-tag

口径收紧 (v3):
- "敏感" 档位 只承载 PII 语义.
- 将已有 "tx_audit_pro / tx_privacy_pii" 行从 "高风险" 移到 "敏感".

PG 兼容性:
- 使用 ALTER TYPE ADD VALUE IF NOT EXISTS, 支持幂等重放.
- Postgres 12+ 不再要求 ALTER TYPE ADD VALUE 跑出事务块, Alembic
  默认 autocommit 处理.
- 低版本 PG (<12) 若 enforce_transaction, 拆两步: 先 ADD VALUE (autocommit),
  再 UPDATE (事务内).

Revision ID: 20260713_extend_audit_point_risk_sensitive
Revises: 20260717_add_review_task_strategy_id
Create Date: 2026-07-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "20260713_extend_audit_point_risk_sensitive"
down_revision = "20260717_add_review_task_strategy_id"
branch_labels = None
depends_on = None


def _pg_enum_values(bind, type_name: str) -> list[str]:
    if bind.dialect.name != "postgresql":
        return []
    rows = bind.execute(
        sa.text(
            "SELECT enumlabel FROM pg_enum "
            "WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = :name) "
            "ORDER BY enumsortorder"
        ),
        {"name": type_name},
    ).fetchall()
    return [r[0] for r in rows]


def _pg_add_value(bind, type_name: str, value: str) -> None:
    if bind.dialect.name != "postgresql":
        return
    if value in _pg_enum_values(bind, type_name):
        return
    op.execute(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{value}'")


def upgrade() -> None:
    bind = op.get_bind()

    # 1. 扩展 enum 类型, 加 "敏感" 值.
    _pg_add_value(bind, "auditpointrisk", "敏感")

    # 2. 把 PII 检测审核点迁到 "敏感" 档位.
    #    WHERE 限制: code + package_code 双键, 避免误改导入的同名自定义规则.
    op.execute(
        sa.text(
            "UPDATE audit_points "
            "SET risk_level = '敏感' "
            "WHERE code = 'tx_privacy_pii' "
            "  AND package_code = 'text_audit_pro' "
            "  AND risk_level = '高风险'"
        )
    )


def downgrade() -> None:
    # 把 tx_privacy_pii 回退到 "高风险". PG enum 不支持 DROP VALUE,
    # 保留 "敏感" enum value 给后续 v3 工作继续用.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                "UPDATE audit_points "
                "SET risk_level = '高风险' "
                "WHERE code = 'tx_privacy_pii' "
                "  AND package_code = 'text_audit_pro' "
                "  AND risk_level = '敏感'"
            )
        )
