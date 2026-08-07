"""Unit tests for strategy ↔ point level enable/disable (step 2 of strategy editor).

覆盖决策：
    item 关 → point 自动关（保留用户记忆）；item 重开 → 恢复上次点级状态。
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


def _make_point(id_: int, item_id: int, package_code: str = "image_audit_pro") -> MagicMock:
    p = MagicMock()
    p.id = id_
    p.item_id = item_id
    p.package_code = package_code
    return p


def _make_strategy_point(
    strategy_id: int,
    point_id: int,
    item_id: int,
    media_type: str = "image",
    is_enabled: bool = True,
) -> MagicMock:
    sp = MagicMock()
    sp.id = point_id * 1000 + strategy_id
    sp.strategy_id = strategy_id
    sp.point_id = point_id
    sp.item_id = item_id
    sp.media_type = media_type
    sp.is_enabled = is_enabled
    return sp


@pytest.mark.asyncio
async def test_replace_enabled_points_upserts_requested_points():
    """请求列表里的 point 全部 upsert 到 strategy_points。"""
    from app.api.v1.strategies import _replace_enabled_points
    from app.schemas.strategy import StrategyPointRef

    db = MagicMock()
    db.add = MagicMock()
    db.get = AsyncMock(side_effect=lambda Model, pk: _make_point(pk, item_id=1))
    # SELECT existing → empty
    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=exec_result)

    refs = [
        StrategyPointRef(media_type="image", item_id=1, point_id=10, is_enabled=True),
        StrategyPointRef(media_type="image", item_id=1, point_id=11, is_enabled=False),
    ]
    await _replace_enabled_points(db, strategy_id=1, enabled_points=refs)

    # 两次 db.add（两条 point 新增）
    assert db.add.call_count == 2
    adds = [c.args[0] for c in db.add.call_args_list]
    assert adds[0].point_id == 10 and adds[0].is_enabled is True
    assert adds[1].point_id == 11 and adds[1].is_enabled is False


@pytest.mark.asyncio
async def test_replace_enabled_points_skips_nonexistent_point():
    """请求了不存在的 point_id → 静默跳过（不抛错）。"""
    from app.api.v1.strategies import _replace_enabled_points
    from app.schemas.strategy import StrategyPointRef

    db = MagicMock()
    db.add = MagicMock()
    db.get = AsyncMock(return_value=None)  # point 不存在
    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=exec_result)

    refs = [StrategyPointRef(media_type="image", item_id=1, point_id=999, is_enabled=True)]
    await _replace_enabled_points(db, strategy_id=1, enabled_points=refs)

    assert db.add.call_count == 0


@pytest.mark.asyncio
async def test_cascade_item_off_disables_points_but_keeps_rows():
    """级联规则 ①：item 关闭时其下 point 自动 is_enabled=false（保留行）。"""
    from app.api.v1.strategies import _replace_enabled_points
    from app.schemas.strategy import StrategyItemRef, StrategyPointRef

    db = MagicMock()
    db.add = MagicMock()
    db.get = AsyncMock(side_effect=lambda Model, pk: _make_point(pk, item_id=1))

    # 模拟 DB 中已存在的 point 行（属于 item 1，is_enabled=true）
    existing_row = _make_strategy_point(
        strategy_id=1, point_id=10, item_id=1, is_enabled=True
    )
    existing_row.is_enabled = True  # 初始为开

    # 第一次 execute 走 "scan all existing points" → 返回 [existing_row]
    # （enabled_points 为空，不会进入 upsert 分支）
    scan_result = MagicMock()
    scan_result.scalars.return_value = iter([existing_row])
    db.execute = AsyncMock(return_value=scan_result)

    # 不传 enabled_points（仅传 enabled_items，且 item 是关的）
    items = [StrategyItemRef(media_type="image", item_id=1, is_enabled=False)]
    await _replace_enabled_points(
        db, strategy_id=1, enabled_points=[], enabled_items=items
    )

    # existing_row 仍存在，但 is_enabled 被翻成 False
    assert existing_row.is_enabled is False
    # 没有任何 db.add（保留旧行，不删不增）
    assert db.add.call_count == 0


@pytest.mark.asyncio
async def test_cascade_item_off_then_on_restores_points():
    """级联规则 ②：item 关 → 重开时，恢复上次显式记录的点级状态。

    场景：
        1) 首次记录：item 1 开，point 10/11 都显式为 true/false
        2) item 1 关 → 两者都被翻成 false（保留行）
        3) item 1 重开 → 显式请求 point 10=true → 10 翻回 true；11 保持 false（记忆）
    """
    from app.api.v1.strategies import _replace_enabled_points
    from app.schemas.strategy import StrategyItemRef, StrategyPointRef

    # 第 3 步：item 1 重开，请求仅 point 10=true
    db = MagicMock()
    db.add = MagicMock()
    db.get = AsyncMock(side_effect=lambda Model, pk: _make_point(pk, item_id=1))

    p10_row = _make_strategy_point(strategy_id=1, point_id=10, item_id=1, is_enabled=False)
    p11_row = _make_strategy_point(strategy_id=1, point_id=11, item_id=1, is_enabled=False)

    # execute 模拟：第一次查 p10 existing → 返回 p10_row
    # 第二次（外层循环查 p11）需要走 scalar_one_or_none 也命中
    call_count = {"n": 0}

    def execute_side_effect(*args, **kwargs):
        call_count["n"] += 1
        result = MagicMock()
        # 第一次 execute 命中 upsert 查询（point 10）；后续是外层 scan 时被用，
        # 实际 scan 在代码中是单独的 select，但为了简化我们只需验证 mutate
        if call_count["n"] == 1:
            result.scalar_one_or_none.return_value = p10_row
        else:
            result.scalar_one_or_none.return_value = None
        # 让 scalars() 返回可迭代对象（含 p11_row），用于外层 scan
        result.scalars.return_value = iter([p10_row, p11_row])
        return result

    db.execute = AsyncMock(side_effect=execute_side_effect)

    items = [StrategyItemRef(media_type="image", item_id=1, is_enabled=True)]
    refs = [StrategyPointRef(media_type="image", item_id=1, point_id=10, is_enabled=True)]
    await _replace_enabled_points(
        db, strategy_id=1, enabled_points=refs, enabled_items=items
    )

    # p10 翻回 true（用户显式请求）
    assert p10_row.is_enabled is True
    # p11 仍为 false（item 在 enabled_items 中 → 外层 scan 不动）— 实际代码逻辑
    # 中外层 scan 只翻「item 不在 enabled_item_keys」的情况，p11.item_id=1 在
    # enabled_item_keys 中，所以保持原值。
    assert p11_row.is_enabled is False


@pytest.mark.asyncio
async def test_orphan_point_kept_disabled():
    """孤儿 point（item 已被移除 enabled_items）→ 保留行但 is_enabled=false。"""
    from app.api.v1.strategies import _replace_enabled_points
    from app.schemas.strategy import StrategyItemRef

    db = MagicMock()
    db.add = MagicMock()
    db.get = AsyncMock(return_value=None)

    orphan = _make_strategy_point(strategy_id=1, point_id=99, item_id=42, is_enabled=True)

    exec_result = MagicMock()
    exec_result.scalar_one_or_none.return_value = None
    exec_result.scalars.return_value = iter([orphan])
    db.execute = AsyncMock(return_value=exec_result)

    # enabled_items 为空 → 没有任何 item 在 keys 中 → orphan 必被翻 false
    await _replace_enabled_points(
        db,
        strategy_id=1,
        enabled_points=[],
        enabled_items=[],
    )

    assert orphan.is_enabled is False
