"""MaterialPackage models - groups multiple materials for batch review."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class PackageStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    COMPLETED = "completed"


class MaterialPackage(Base):
    """A named group of materials submitted for review together."""

    __tablename__ = "material_packages"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    material_type: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[PackageStatus] = mapped_column(
        Enum(PackageStatus), default=PackageStatus.DRAFT, nullable=False, index=True
    )
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[List["MaterialPackageItem"]] = relationship(
        back_populates="package",
        cascade="all, delete-orphan",
        order_by="MaterialPackageItem.position",
    )
    creator = relationship("User")


class MaterialPackageItem(Base):
    """A material belonging to a package, with ordering and optional task link."""

    __tablename__ = "material_package_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    package_id: Mapped[int] = mapped_column(
        ForeignKey("material_packages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("review_tasks.id"), nullable=True
    )

    package: Mapped["MaterialPackage"] = relationship(back_populates="items")
    material = relationship("Material")
    review_task = relationship("ReviewTask")

    __table_args__ = (
        UniqueConstraint("package_id", "material_id", name="uq_package_item"),
    )
