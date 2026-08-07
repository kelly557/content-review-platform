"""RuleSet and StrategyPointV2 (Phase B).

RuleSet = 策略"原料"组合：审核点 + compose/voice/audio_features 配置。

注：当前 Phase A 仍把 enabled_points / voice / audio_features / doc /
video 字段塞进 strategies.definition。Phase B 起这些内容被 R-Split 出来
到 rule_sets 与 strategy_points_v2，strategies 只保留 (rule_set_id,
disposition_rule_id) 二元组。

PR B1 仅引入 model + DDL，不改 service 路径；strategies.definition 保留
作为回退阅读通道，Phase B3 开始接管。
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.core.id_generator import new_public_id


class RuleSet(Base):
    __tablename__ = "rule_sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)

    # 原始型配置：voice_rule_mode / audio_features / doc_*_mode / video_*_mode / video_frame_interval_sec
    # 一切原本写在 strategies.definition.{...} 的多模态审计"原料"。
    config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=False, default=dict)

    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 未来启用「冻结历史态」可置 FALSE；本期默认 TRUE，所有非内置资源可编辑。
    is_editable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    locked_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    locked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    points: Mapped[list["StrategyPointV2"]] = relationship(
        back_populates="rule_set",
        cascade="all, delete-orphan",
        order_by="StrategyPointV2.id",
    )
    strategies: Mapped[list["Strategy"]] = relationship(
        back_populates="rule_set", foreign_keys="Strategy.rule_set_id"
    )

    __table_args__ = (UniqueConstraint("code", name="uq_rule_sets_code"),)


class StrategyPointV2(Base):
    """审核点 v2：挂在 rule_set 下。

    对应原 strategy_points (Phase A)：item 级联禁用语义 1:1 保留。
    """

    __tablename__ = "strategy_points_v2"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False, default=new_public_id
    )
    rule_set_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("rule_sets.id", ondelete="CASCADE"), nullable=False
    )
    media_type: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("audit_items.id", ondelete="CASCADE"), nullable=False
    )
    point_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("audit_points.id", ondelete="CASCADE"), nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    medium_threshold: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)
    high_threshold: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)
    linked_library_ids: Mapped[Optional[list[int]]] = mapped_column(
        ARRAY(Integer), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )

    rule_set = relationship("RuleSet", back_populates="points")

    __table_args__ = (
        UniqueConstraint("rule_set_id", "point_id", name="uq_rs_point_v2"),
        Index("ix_sp_v2_rs", "rule_set_id"),
    )
