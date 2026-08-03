"""Tag 三级级联 + 模型绑定 + tree/references API 测试。"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.models.registered_model import RegisteredModel, RegisteredModelKind
from app.models.tag import (
    TAG_LEVEL_LEAF,
    TAG_LEVEL_MID,
    TAG_LEVEL_TOP,
    TagCategory,
    TagDomain,
    TagStatus,
)


async def _login(client: AsyncClient, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text


@pytest.fixture
async def admin_client(client: AsyncClient) -> AsyncClient:
    """Use the shared conftest client (which seeds admin users) and login as admin."""
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@adreview.example.com", "password": "admin123"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client


async def _make_small_model(db_session_factory) -> int:
    async with db_session_factory() as session:
        m = RegisteredModel(
            code="test_small_1",
            name="test_small_1",
            kind=RegisteredModelKind.SMALL.value,
            small_category="politics",
            modality="image",
            registration_method="uploaded_file",
            status="active",
        )
        session.add(m)
        await session.commit()
        await session.refresh(m)
        return m.id


async def _make_tag_payload(
    *,
    code: str,
    name: str,
    level: int,
    parent_id: str | None = None,
    bound_model_id: int | None = None,
    bound_model_kind: str | None = None,
) -> dict:
    return {
        "code": code,
        "name": name,
        "domain": TagDomain.POLITICS.value,
        "category": TagCategory.FIGURE.value,
        "status": TagStatus.ACTIVE.value,
        "level": level,
        "parent_id": parent_id,
        "bound_model_id": bound_model_id,
        "bound_model_kind": bound_model_kind,
    }


async def test_create_top_level_ok(admin_client: AsyncClient) -> None:
    r = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_politics", name="涉政", level=TAG_LEVEL_TOP
        ),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["level"] == 1
    assert body["parent_id"] is None
    assert body["bound_model_id"] is None


async def test_create_l2_requires_l1_parent(admin_client: AsyncClient) -> None:
    # 不传 parent
    r = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_l2_no_parent", name="no_parent", level=TAG_LEVEL_MID
        ),
    )
    assert r.status_code == 400
    assert "二级标签必须指定父级" in r.text


async def test_create_l2_parent_must_be_l1(admin_client: AsyncClient) -> None:
    # 创建一个顶级
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_top1", name="t_top", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]
    # 在顶级下建一个二级
    mid = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_mid1",
            name="t_mid",
            level=TAG_LEVEL_MID,
            parent_id=top_id,
        ),
    )
    mid_id = mid.json()["id"]
    # 试图在二级下建一个二级（错级）
    r = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_mid2",
            name="t_mid2",
            level=TAG_LEVEL_MID,
            parent_id=mid_id,
        ),
    )
    assert r.status_code == 400
    assert "二级标签的父级必须是一级" in r.text


async def test_create_l3_allows_no_bound_model(
    admin_client: AsyncClient, db_session_factory
) -> None:
    model_id = await _make_small_model(db_session_factory)
    # 建一级
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_top_x", name="t_top_x", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]
    mid = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_mid_x",
            name="t_mid_x",
            level=TAG_LEVEL_MID,
            parent_id=top_id,
        ),
    )
    mid_id = mid.json()["id"]

    # 三级标签允许不绑模型（v2 业务规则）
    r = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_leaf_x",
            name="t_leaf_x",
            level=TAG_LEVEL_LEAF,
            parent_id=mid_id,
        ),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["level"] == TAG_LEVEL_LEAF
    assert body["bound_model_id"] is None
    assert body["bound_model_kind"] is None

    # 正确路径
    r2 = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_leaf_y",
            name="t_leaf_y",
            level=TAG_LEVEL_LEAF,
            parent_id=mid_id,
            bound_model_id=model_id,
            bound_model_kind="small",
        ),
    )
    assert r2.status_code == 201, r2.text
    body = r2.json()
    assert body["level"] == 3
    assert body["bound_model_id"] == model_id
    assert body["bound_model_kind"] == "small"


async def test_create_l1_disallows_parent(admin_client: AsyncClient) -> None:
    r = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_top_bad",
            name="t_top_bad",
            level=TAG_LEVEL_TOP,
            parent_id="anything",
        ),
    )
    assert r.status_code == 400
    assert "一级标签不能有父级" in r.text


async def test_create_l3_wrong_kind_rejected(
    admin_client: AsyncClient, db_session_factory
) -> None:
    model_id = await _make_small_model(db_session_factory)
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_top_z", name="t_top_z", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]
    mid = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_mid_z",
            name="t_mid_z",
            level=TAG_LEVEL_MID,
            parent_id=top_id,
        ),
    )
    mid_id = mid.json()["id"]
    # 错把 small 模型声明为 large
    r = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_leaf_z",
            name="t_leaf_z",
            level=TAG_LEVEL_LEAF,
            parent_id=mid_id,
            bound_model_id=model_id,
            bound_model_kind="large",
        ),
    )
    assert r.status_code == 400
    assert "类型是 small" in r.text


async def test_tree_returns_nested(
    admin_client: AsyncClient, db_session_factory
) -> None:
    model_id = await _make_small_model(db_session_factory)
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_a", name="涉政", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]
    mid = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_b", name="一号领导", level=TAG_LEVEL_MID, parent_id=top_id
        ),
    )
    mid_id = mid.json()["id"]
    leaf = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_c",
            name="漫画",
            level=TAG_LEVEL_LEAF,
            parent_id=mid_id,
            bound_model_id=model_id,
            bound_model_kind="small",
        ),
    )
    assert leaf.status_code == 201

    r = await admin_client.get("/api/v1/tags/tree")
    assert r.status_code == 200
    tree = r.json()
    assert len(tree) == 1
    root = tree[0]
    assert root["name"] == "涉政"
    assert root["level"] == 1
    assert len(root["children"]) == 1
    assert root["children"][0]["name"] == "一号领导"
    assert len(root["children"][0]["children"]) == 1
    leaf_node = root["children"][0]["children"][0]
    assert leaf_node["name"] == "漫画"
    assert leaf_node["bound_model_label"] is not None


async def test_references_by_model(
    admin_client: AsyncClient, db_session_factory
) -> None:
    model_id = await _make_small_model(db_session_factory)
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_x1", name="涉政", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]
    mid = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_x2", name="一号领导", level=TAG_LEVEL_MID, parent_id=top_id
        ),
    )
    mid_id = mid.json()["id"]
    await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_x3",
            name="漫画",
            level=TAG_LEVEL_LEAF,
            parent_id=mid_id,
            bound_model_id=model_id,
            bound_model_kind="small",
        ),
    )
    r = await admin_client.get("/api/v1/tags/references", params={"model_id": model_id})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["path"] == "涉政 / 一号领导 / 漫画"


async def test_delete_cascades_children(
    admin_client: AsyncClient, db_session_factory
) -> None:
    model_id = await _make_small_model(db_session_factory)
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_d1", name="涉政", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]
    mid = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_d2", name="一号领导", level=TAG_LEVEL_MID, parent_id=top_id
        ),
    )
    mid_id = mid.json()["id"]
    await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="t_d3",
            name="漫画",
            level=TAG_LEVEL_LEAF,
            parent_id=mid_id,
            bound_model_id=model_id,
            bound_model_kind="small",
        ),
    )

    r = await admin_client.delete(f"/api/v1/tags/{top_id}")
    assert r.status_code == 204

    tree = (await admin_client.get("/api/v1/tags/tree")).json()
    assert tree == []