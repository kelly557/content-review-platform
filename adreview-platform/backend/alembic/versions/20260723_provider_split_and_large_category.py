"""model registry: Provider 二级化 + 大模型三分类

- 新表 registered_providers：display_name, preset, endpoint_url, credential_id, status
- registered_models：
  - 加 provider_id (FK) + large_category ('text'/'multimodal'/'other')
  - 历史数据按 (provider, endpoint_url, credential_id) 三元组建 Provider 并回填 provider_id
  - 默认 large_category='other'
  - 在 kind='large' 上 CHECK large_category NOT NULL；kind='small' large_category IS NULL
- registered_model_versions：加 large_category 列
- 索引：provider_id (FK), large_category
- unique(registered_models.provider_id, registered_models.model)（drop 后再加：迁移路径避免命名冲突先用业务层校验）
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op


revision = "20260723_provider_split_and_large_category"
down_revision = ("20260722_model_kind_and_categories", "20260714_small_model_upload")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 新表 registered_providers
    op.create_table(
        "registered_providers",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("provider_preset", sa.String(length=64), nullable=True),
        sa.Column("endpoint_url", sa.Text(), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "credential_id",
            sa.BigInteger(),
            sa.ForeignKey("resource_credentials.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "owner_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_by_id",
            sa.BigInteger(),
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
        sa.UniqueConstraint("public_id", name="uq_registered_providers_public_id"),
        sa.UniqueConstraint("code", name="uq_registered_providers_code"),
    )
    op.create_index(
        "ix_registered_providers_credential_id",
        "registered_providers",
        ["credential_id"],
    )
    op.create_index(
        "ix_registered_providers_status",
        "registered_providers",
        ["status"],
    )

    # 2) 给 registered_models 加 provider_id + large_category
    op.add_column(
        "registered_models",
        sa.Column(
            "provider_id",
            sa.BigInteger(),
            sa.ForeignKey("registered_providers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "registered_models",
        sa.Column("large_category", sa.String(length=16), nullable=True),
    )
    op.create_index(
        "ix_registered_models_provider_id",
        "registered_models",
        ["provider_id"],
    )
    op.create_index(
        "ix_registered_models_large_category",
        "registered_models",
        ["large_category"],
    )

    # 3) 数据回填：把现存大模型按 (provider, endpoint_url, credential_id) 三元组建 Provider
    #    small 模型也走相同规则（虽然历史未配 endpoint_url，但占位统一迁移）
    bind = op.get_bind()
    meta = sa.MetaData()
    meta.bind = bind
    rm = sa.Table(
        "registered_models",
        meta,
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("provider", sa.String(128)),
        sa.Column("endpoint_url", sa.Text),
        sa.Column("credential_id", sa.BigInteger),
        sa.Column("kind", sa.String(8)),
        sa.Column("provider_id", sa.BigInteger),
        sa.Column("large_category", sa.String(16)),
    )
    rp = sa.Table(
        "registered_providers",
        meta,
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("public_id", sa.String(36)),
        sa.Column("code", sa.String(64)),
        sa.Column("display_name", sa.String(128)),
        sa.Column("description", sa.Text),
        sa.Column("provider_preset", sa.String(64)),
        sa.Column("endpoint_url", sa.Text),
        sa.Column("credential_id", sa.BigInteger),
        sa.Column("status", sa.String(16)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    import uuid as _uuid
    from datetime import datetime, timezone

    rows = list(bind.execute(sa.select(rm.c.id, rm.c.provider, rm.c.endpoint_url, rm.c.credential_id, rm.c.kind)))
    provider_cache: dict[tuple, int] = {}
    for r in rows:
        preset = (r.provider or "custom").strip() or "custom"
        endpoint = (r.endpoint_url or "").strip() or f"unknown://model-{r.id}"
        cred_id = r.credential_id
        key = (preset, endpoint, cred_id)
        if key in provider_cache:
            pid = provider_cache[key]
        else:
            code = f"prv_{preset.replace('-', '_')}_{_uuid.uuid4().hex[:6]}"
            result = bind.execute(
                rp.insert().values(
                    public_id=str(_uuid.uuid4()),
                    code=code,
                    display_name=f"{preset} ({endpoint[:48]})",
                    description="由历史数据自动迁移",
                    provider_preset=preset,
                    endpoint_url=endpoint,
                    credential_id=cred_id,
                    status="active",
                    created_at=datetime.now(timezone.utc),
                )
            )
            pid = result.inserted_primary_key[0]
            provider_cache[key] = pid
        bind.execute(
            rm.update()
            .where(rm.c.id == r.id)
            .values(provider_id=pid)
        )

    # 4) 回填 large_category：所有大模型置 'other'；小模型保持 NULL
    bind.execute(
        rm.update()
        .where(rm.c.kind == "large")
        .where(rm.c.large_category.is_(None))
        .values(large_category="other")
    )

    # 5) large_category NOT NULL 对于 kind='large' 的 CHECK
    #    用 ALTER TABLE … ADD CONSTRAINT CHECK
    op.create_check_constraint(
        "ck_registered_models_large_category_when_large",
        "registered_models",
        "kind <> 'large' OR large_category IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_registered_models_large_category_when_small",
        "registered_models",
        "kind <> 'small' OR large_category IS NULL",
    )

    # 6) registered_model_versions 同步加 large_category 列
    op.add_column(
        "registered_model_versions",
        sa.Column("large_category", sa.String(length=16), nullable=True),
    )
    op.create_index(
        "ix_registered_model_versions_large_category",
        "registered_model_versions",
        ["large_category"],
    )


def downgrade() -> None:
    op.drop_index("ix_registered_model_versions_large_category", table_name="registered_model_versions")
    op.drop_column("registered_model_versions", "large_category")

    op.drop_constraint("ck_registered_models_large_category_when_small", "registered_models", type_="check")
    op.drop_constraint("ck_registered_models_large_category_when_large", "registered_models", type_="check")
    op.drop_index("ix_registered_models_large_category", table_name="registered_models")
    op.drop_index("ix_registered_models_provider_id", table_name="registered_models")
    op.drop_column("registered_models", "large_category")
    op.drop_column("registered_models", "provider_id")

    op.drop_index("ix_registered_providers_status", table_name="registered_providers")
    op.drop_index("ix_registered_providers_credential_id", table_name="registered_providers")
    op.drop_table("registered_providers")
