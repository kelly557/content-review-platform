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


async def _mk_service(db_session, code: str):
    from app.models.service import Service

    svc = Service(code=code, name=code)
    db_session.add(svc)
    await db_session.commit()
    return svc


async def _mk_item_and_point(client, pkg_code: str):
    """经 API 创建 item 与父 point，返回 (item_id, point_id)。"""
    r = await client.post(
        f"/api/v1/packages/{pkg_code}/items",
        json={"name_cn": "测试审核项"},
    )
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    r = await client.post(
        f"/api/v1/packages/{pkg_code}/points",
        json={"item_id": item_id, "label_cn": "父审核点"},
    )
    assert r.status_code == 201, r.text
    point_id = r.json()["id"]
    return item_id, point_id


async def test_sub_points_empty_initially(client, db_session):
    svc = await _mk_service(db_session, "test_pkg_sub_a")
    await _login(client, "admin@adreview.example.com", "admin123")
    item_id, point_id = await _mk_item_and_point(client, svc.code)

    r = await client.get(f"/api/v1/packages/{svc.code}/points/{point_id}/sub-points")
    assert r.status_code == 200, r.text
    assert r.json() == []


async def test_create_and_list_sub_point(client, db_session):
    svc = await _mk_service(db_session, "test_pkg_sub_b")
    await _login(client, "admin@adreview.example.com", "admin123")
    item_id, point_id = await _mk_item_and_point(client, svc.code)

    r = await client.post(
        f"/api/v1/packages/{svc.code}/points/{point_id}/sub-points",
        json={"item_id": item_id, "label_cn": "三级子点1"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["parent_point_id"] == point_id

    r = await client.get(f"/api/v1/packages/{svc.code}/points/{point_id}/sub-points")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["label_cn"] == "三级子点1"


async def test_sub_point_404_for_missing_parent(client, db_session):
    svc = await _mk_service(db_session, "test_pkg_sub_c")
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.get(f"/api/v1/packages/{svc.code}/points/999999/sub-points")
    assert r.status_code == 404
