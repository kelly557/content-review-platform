"""add uploaded_documents and audit_point source_document columns

Refactor: 用户的「自定义规则 Agent」可上传知识文件（.pdf/.docx/.txt/.md/.xlsx/.csv），
由系统/LLM 解析为审核点。每条审核点记录来源文件，便于全生命周期追溯。

新增表：

- ``uploaded_documents``：保存用户上传的源文件元数据（文件名/存储 key/状态/解析方式等）。

扩展表：

- ``audit_points``：
  - ``source_document_id``：回溯到 ``uploaded_documents.id``（FK，ON DELETE SET NULL）。
  - ``source_quote``：原文片段（仅 LLM 解析时有值）。
  - ``source_line_no``：结构化文件中的行号。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260720_add_uploaded_documents"
down_revision = "20260730_users_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) uploaded_documents
    op.create_table(
        "uploaded_documents",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "item_id",
            sa.Integer(),
            sa.ForeignKey("audit_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("package_code", sa.String(length=64), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("structured", "llm", name="uploadeddoc_kind"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("mime_type", sa.String(length=128), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending", "parsing", "parsed", "failed",
                name="uploadeddoc_status",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "parsed_point_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("parsed_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("prompt_markdown", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
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
    )
    op.create_index(
        "ix_uploaded_documents_item_id", "uploaded_documents", ["item_id"]
    )
    op.create_index(
        "ix_uploaded_documents_package_code",
        "uploaded_documents",
        ["package_code"],
    )
    op.create_index(
        "ix_uploaded_documents_status", "uploaded_documents", ["status"]
    )
    op.create_index(
        "ix_uploaded_documents_item_status",
        "uploaded_documents",
        ["item_id", "status"],
    )

    # 2) audit_points source_* columns
    op.add_column(
        "audit_points",
        sa.Column(
            "source_document_id",
            sa.BigInteger(),
            sa.ForeignKey("uploaded_documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_audit_points_source_document_id",
        "audit_points",
        ["source_document_id"],
    )
    op.add_column(
        "audit_points",
        sa.Column("source_quote", sa.Text(), nullable=True),
    )
    op.add_column(
        "audit_points",
        sa.Column("source_line_no", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("audit_points", "source_line_no")
    op.drop_column("audit_points", "source_quote")
    op.drop_index(
        "ix_audit_points_source_document_id", table_name="audit_points"
    )
    op.drop_column("audit_points", "source_document_id")

    op.drop_index(
        "ix_uploaded_documents_item_status", table_name="uploaded_documents"
    )
    op.drop_index("ix_uploaded_documents_status", table_name="uploaded_documents")
    op.drop_index(
        "ix_uploaded_documents_package_code", table_name="uploaded_documents"
    )
    op.drop_index("ix_uploaded_documents_item_id", table_name="uploaded_documents")
    op.drop_table("uploaded_documents")
    sa.Enum(name="uploadeddoc_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="uploadeddoc_kind").drop(op.get_bind(), checkfirst=True)