"""Review Agent model — 审核智能体（可发布版本的检测 Agent 配置）."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.id_generator import new_public_id
from app.db.session import Base


class ReviewAgent(Base):
    __tablename__ = "review_agents"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    app_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    modality: Mapped[str] = mapped_column(String(16), nullable=False)  # 文本/图像/图文/音频/视频
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="未发布")  # 已发布/未发布/已下线
    model_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("registered_models.id", ondelete="SET NULL"), nullable=True, index=True
    )
    points: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    online_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    draft_saved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    current_version: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    versions: Mapped[List["ReviewAgentVersion"]] = relationship(  # type: ignore[name-defined]
        back_populates="agent", cascade="all, delete-orphan", order_by="ReviewAgentVersion.id.desc()"
    )


class ReviewAgentVersion(Base):
    __tablename__ = "review_agent_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("review_agents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version: Mapped[str] = mapped_column(String(32), nullable=False)  # v1, v2...
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="published")
    is_current: Mapped[bool] = mapped_column(default=False, nullable=False)
    snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    agent: Mapped["ReviewAgent"] = relationship(  # type: ignore[name-defined]
        back_populates="versions"
    )
