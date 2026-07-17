"""Tests for Phase B: strategies write path accepts rule_set_id + disposition_rule_id.

These tests validate the new wiring in app/api/v1/strategies.py:
- Schema accepts rule_set_id + disposition_rule_id
- FK existence is validated (400 if missing)
- The new fields are persisted in DB
- definition.human_review is no longer written

注：项目 conftest 的 db_session fixture 不自动 seed admin user。
各测试在用 db_session 前先写一个 admin user 拿到 id。
"""
from __future__ import annotations

import pytest

import app.models  # noqa: F401


async def _ensure_admin(db_session) -> int:
    """在测试 schema 写一个 admin user，返回 id。如果已存在直接返回。"""
    from app.core.id_generator import new_public_id
    from app.core.security import hash_password
    from app.models import User, UserRole
    from sqlalchemy import select

    existing = (
        await db_session.execute(
            select(User).where(User.email == "admin@adreview.example.com")
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing.id
    admin = User(
        public_id=new_public_id(),
        email="admin@adreview.example.com",
        full_name="Admin",
        hashed_password=hash_password("admin123"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db_session.add(admin)
    await db_session.flush()
    return admin.id


async def _seed_rs_and_dr(db_session) -> tuple[int, int]:
    """直连 DB 写一条 RuleSet + DispositionRule，返回 id 对。

    不用 ``db_session.add + flush`` 一次完成 —— 跨 prepared-statement 缓存也安全。
    """
    from app.core.id_generator import new_public_id
    from app.models import DispositionRule, RuleSet

    rs = RuleSet(
        public_id=new_public_id(),
        code="rs_phase_b3",
        name="phase b test rs",
        config={},
        is_builtin=False,
        is_editable=True,
    )
    dr = DispositionRule(
        public_id=new_public_id(),
        code="dr_phase_b3",
        name="phase b test dr",
        is_enabled=False,
        risk_levels=[],
        sensitive_levels=[],
        review_rule_id=None,
        sample_ratio=100.0,
        auto_action_overrides={},
        is_builtin=False,
        is_editable=True,
    )
    db_session.add_all([rs, dr])
    await db_session.flush()
    return rs.id, dr.id


@pytest.mark.asyncio
async def test_strategy_create_validates_rule_set_id_400(db_session):
    """rule_set_id 不存在应 400。"""
    from fastapi import HTTPException

    from app.api.v1.strategies import create_strategy
    from app.models.user import UserRole
    from app.schemas.strategy import StrategyCreate

    admin_id = await _ensure_admin(db_session)
    user = type("U", (), {"id": admin_id, "role": UserRole.ADMIN})()
    with pytest.raises(HTTPException) as ei:
        await create_strategy(
            body=StrategyCreate(
                name="x",
                rule_set_id=999_999,
                disposition_rule_id=999_999,
            ),
            db=db_session,
            user=user,
        )
    assert ei.value.status_code == 400


@pytest.mark.asyncio
async def test_strategy_create_persists_phase_b_fks(db_session):
    """直调 handler：rule_set_id + disposition_rule_id 应被写入 strategy 行。"""
    from app.api.v1.strategies import create_strategy
    from app.models import Strategy
    from app.models.user import UserRole
    from app.schemas.strategy import StrategyCreate

    rs_id, dr_id = await _seed_rs_and_dr(db_session)
    admin_id = await _ensure_admin(db_session)
    user = type("U", (), {"id": admin_id, "role": UserRole.ADMIN})()
    body = StrategyCreate(
        name="phase b test",
        rule_set_id=rs_id,
        disposition_rule_id=dr_id,
    )
    out = await create_strategy(body=body, db=db_session, user=user)

    assert out.id is not None
    assert out.rule_set_id == rs_id
    assert out.disposition_rule_id == dr_id

    s = (
        await db_session.execute(
            Strategy.__table__.select().where(Strategy.id == out.id)
        )
    ).first()
    assert s is not None
    assert s.rule_set_id == rs_id
    assert s.disposition_rule_id == dr_id


@pytest.mark.asyncio
async def test_strategy_create_no_longer_writes_human_review_in_definition(db_session):
    """create 不再写 definition.human_review。"""
    from app.api.v1.strategies import create_strategy
    from app.models import Strategy
    from app.models.user import UserRole
    from app.schemas.strategy import StrategyCreate

    rs_id, dr_id = await _seed_rs_and_dr(db_session)
    admin_id = await _ensure_admin(db_session)
    user = type("U", (), {"id": admin_id, "role": UserRole.ADMIN})()

    out = await create_strategy(
        body=StrategyCreate(
            name="no_hr",
            rule_set_id=rs_id,
            disposition_rule_id=dr_id,
        ),
        db=db_session,
        user=user,
    )
    row = (
        await db_session.execute(
            Strategy.__table__.select().where(Strategy.id == out.id)
        )
    ).first()
    definition = row.definition or {}
    assert "human_review" not in definition


@pytest.mark.asyncio
async def test_strategy_update_changes_fks(db_session):
    """update 可改 rule_set_id / disposition_rule_id，DB 真实持久化。"""
    from app.api.v1.strategies import create_strategy, update_strategy
    from app.models.user import UserRole
    from app.schemas.strategy import StrategyCreate, StrategyUpdate

    rs_id, dr_id = await _seed_rs_and_dr(db_session)
    admin_id = await _ensure_admin(db_session)
    user = type("U", (), {"id": admin_id, "role": UserRole.ADMIN})()

    out = await create_strategy(
        body=StrategyCreate(name="phase b upd"),
        db=db_session,
        user=user,
    )
    strat_id = out.id
    assert out.rule_set_id is None
    assert out.disposition_rule_id is None

    upd_out = await update_strategy(
        strategy_id=strat_id,
        body=StrategyUpdate(
            rule_set_id=rs_id,
            disposition_rule_id=dr_id,
        ),
        db=db_session,
        user=user,
    )
    assert upd_out.rule_set_id == rs_id
    assert upd_out.disposition_rule_id == dr_id


@pytest.mark.asyncio
async def test_strategy_duplicate_copies_fks(db_session):
    """duplicate 时 FK 沿用源策略（且 definition.human_review 被清掉）。"""
    from app.api.v1.strategies import create_strategy, duplicate_strategy
    from app.models.user import UserRole
    from app.schemas.strategy import StrategyCreate, StrategyDuplicateRequest

    rs_id, dr_id = await _seed_rs_and_dr(db_session)
    admin_id = await _ensure_admin(db_session)
    user = type("U", (), {"id": admin_id, "role": UserRole.ADMIN})()

    src = await create_strategy(
        body=StrategyCreate(
            name="src",
            rule_set_id=rs_id,
            disposition_rule_id=dr_id,
            definition={"human_review": {"is_enabled": True}, "x": 1},
        ),
        db=db_session,
        user=user,
    )

    dup = await duplicate_strategy(
        strategy_id=src.id,
        body=StrategyDuplicateRequest(name="dup"),
        db=db_session,
        user=user,
    )
    assert dup.id != src.id
    assert dup.rule_set_id == rs_id
    assert dup.disposition_rule_id == dr_id
    assert "human_review" not in (dup.definition or {})


@pytest.mark.asyncio
async def test_workflow_engine_compose_effective_from_disposition(db_session):
    """disposition_rule_id → compose_effective 路径生效。"""
    from app.services.disposition_engine import compose_effective
    from sqlalchemy import update as sa_update

    from app.api.v1.strategies import create_strategy
    from app.models import DispositionRule, Strategy
    from app.models.user import UserRole
    from app.schemas.strategy import StrategyCreate

    rs_id, dr_id = await _seed_rs_and_dr(db_session)
    admin_id = await _ensure_admin(db_session)
    user = type("U", (), {"id": admin_id, "role": UserRole.ADMIN})()

    # 改 dr 为 enabled
    await db_session.execute(
        sa_update(DispositionRule)
        .where(DispositionRule.id == dr_id)
        .values(is_enabled=True, risk_levels=["高风险"])
    )
    await db_session.flush()

    out = await create_strategy(
        body=StrategyCreate(name="b3 wf", disposition_rule_id=dr_id),
        db=db_session,
        user=user,
    )

    effective = await compose_effective(
        db_session,
        strategy_disposition_id=dr_id,
        override_disposition_id=None,
    )
    assert effective["is_enabled"] is True
    assert "高风险" in effective["risk_levels"]

    strat = await db_session.get(Strategy, out.id)
    assert strat.disposition_rule_id == dr_id
