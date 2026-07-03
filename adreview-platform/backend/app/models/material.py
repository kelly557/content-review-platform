"""Material (advertising asset) models - parent + versioned snapshots."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class MaterialType(str, enum.Enum):
    IMAGE = "image"
    VIDEO = "video"
    PDF = "pdf"
    TEXT = "text"


class MaterialStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class Material(Base):
    """Logical material: a piece of marketing content. Owns immutable versions."""

    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    material_type: Mapped[MaterialType] = mapped_column(Enum(MaterialType), nullable=False)
    status: Mapped[MaterialStatus] = mapped_column(
        Enum(MaterialStatus), default=MaterialStatus.DRAFT, nullable=False, index=True
    )
    tags: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    extra_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, default=dict)

    submitter_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    submitter = relationship("User", back_populates="materials", foreign_keys=[submitter_id])

    current_version_id: Mapped[Optional[int]] = mapped_column(ForeignKey("material_versions.id"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    versions: Mapped[List["MaterialVersion"]] = relationship(
        back_populates="material",
        primaryjoin="Material.id == MaterialVersion.material_id",
        order_by="MaterialVersion.version_no.desc()",
        foreign_keys="MaterialVersion.material_id",
    )

    __table_args__ = (Index("ix_materials_status_type", "status", "material_type"),)


class MaterialVersion(Base):
    """Immutable snapshot of a material. Each re-submission creates a new row."""

    __tablename__ = "material_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)

    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checksum: Mapped[Optional[str]] = mapped_column(String(128))

    text_body: Mapped[Optional[str]] = mapped_column(Text)  # for TEXT type or extracted text
    extra: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)

    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    material = relationship("Material", back_populates="versions", foreign_keys=[material_id])

    __table_args__ = (
        Index("ix_material_version_unique", "material_id", "version_no", unique=True),
    )
