"""Tests for audit point sub-points (三级审核点)."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def _login(client, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login",
        json={"identifier": email, "password": password},
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


async def _seed(db_session, pkg_code: str):
    """用 ORM 直接造 service + item + 父 point，返回 (item_id, point_id)。

    用 db_session（与 client 同一 schema）且只做 flush+commit，
    避免触发 AuditItem.linked_library_links 的 selectin 缓存问题。
    """
    from app.models.service import Service
    from app.models.audit_item import AuditItem
    from app.models.audit_point import AuditPoint

    svc = Service(code=pkg_code, name=pkg_code)
    db_session.add(svc)
    await db_session.flush()  # service 先落，满足 audit_items FK
    item = AuditItem(
        package_code=pkg_code,
        code=f"item_{pkg_code}",
        name_cn="测试审核项",
        is_enabled=True,
    )
    db_session.add(item)
    await db_session.flush()  # 拿 item.id，不触发 selectin
    point = AuditPoint(
        package_code=pkg_code,
        item_id=item.id,
        code=f"pt_{pkg_code}",
        label="父审核点",
        label_cn="父审核点",
        risk_level="中风险",
        is_enabled=True,
    )
    db_session.add(point)
    await db_session.flush()  # 拿 point.id
    await db_session.commit()
    return item.id, point.id


async def test_sub_points_empty_initially(client, db_session):
    _, point_id = await _seed(db_session, "test_pkg_sub_a")
    await _login(client, "admin@adreview.example.com", "admin123")

    r = await client.get(
        f"/api/v1/packages/test_pkg_sub_a/points/{point_id}/sub-points"
    )
    assert r.status_code == 200, r.text
    assert r.json() == []


async def test_create_and_list_sub_point(client, db_session):
    item_id, point_id = await _seed(db_session, "test_pkg_sub_b")
    await _login(client, "admin@adreview.example.com", "admin123")

    r = await client.post(
        f"/api/v1/packages/test_pkg_sub_b/points/{point_id}/sub-points",
        json={"item_id": item_id, "label_cn": "三级子点1"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["parent_point_id"] == point_id

    r = await client.get(
        f"/api/v1/packages/test_pkg_sub_b/points/{point_id}/sub-points"
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["label_cn"] == "三级子点1"


async def test_sub_point_404_for_missing_parent(client, db_session):
    await _seed(db_session, "test_pkg_sub_c")
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.get("/api/v1/packages/test_pkg_sub_c/points/999999/sub-points")
    assert r.status_code == 404


async def test_list_all_sub_points_batch(client, db_session):
    """GET /packages/{code}/sub-points 一次返回全包三级 sub（替代逐点 N+1）。"""
    from app.models.audit_point import AuditPoint

    item_id, point_id = await _seed(db_session, "test_pkg_sub_batch")
    await _login(client, "admin@adreview.example.com", "admin123")

    # 造 2 个 sub
    for i in range(2):
        r = await client.post(
            "/api/v1/packages/test_pkg_sub_batch/points/" f"{point_id}/sub-points",
            json={"item_id": item_id, "label_cn": f"sub{i}"},
        )
        assert r.status_code == 201, r.text

    # 批量端点：返回该包全部 sub（parent_point_id 非空）
    r = await client.get("/api/v1/packages/test_pkg_sub_batch/sub-points")
    assert r.status_code == 200, r.text
    subs = r.json()
    assert len(subs) == 2
    assert all(s["parent_point_id"] == point_id for s in subs)
    # 顶级点不在批量结果里
    assert all(s["id"] != point_id for s in subs)


async def test_list_all_sub_points_empty(client, db_session):
    """无 sub 的包返回空列表。"""
    await _seed(db_session, "test_pkg_sub_empty")
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.get("/api/v1/packages/test_pkg_sub_empty/sub-points")
    assert r.status_code == 200
    assert r.json() == []
