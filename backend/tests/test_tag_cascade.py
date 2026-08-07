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
        json={"identifier": email, "password": password},
    )
    assert r.status_code == 200, r.text


@pytest.fixture
async def admin_client(client: AsyncClient) -> AsyncClient:
    """Use the shared conftest client (which seeds admin users) and login as admin."""
    r = await client.post(
        "/api/v1/auth/login",
        json={"identifier": "admin@adreview.example.com", "password": "admin123"},
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


# ───────────────────── 引用清单 + 启用/删除二次确认 ─────────────────────


async def _make_tag_chain_with_bound_model(
    admin_client: AsyncClient, db_session_factory, *, prefix: str
) -> tuple[str, str, int]:
    """建一条 一级/二级/三级 的链,叶子绑定一个小模型。返回 (top_id, mid_id, leaf_id, model_id) 错误 — 返回 3 个"""
    model_id = await _make_small_model(db_session_factory)
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code=f"{prefix}_t1", name=f"{prefix}涉政", level=TAG_LEVEL_TOP
        ),
    )
    assert top.status_code == 201, top.text
    top_id = top.json()["id"]
    mid = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code=f"{prefix}_t2",
            name=f"{prefix}一号领导",
            level=TAG_LEVEL_MID,
            parent_id=top_id,
        ),
    )
    assert mid.status_code == 201, mid.text
    mid_id = mid.json()["id"]
    leaf = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code=f"{prefix}_t3",
            name=f"{prefix}漫画",
            level=TAG_LEVEL_LEAF,
            parent_id=mid_id,
            bound_model_id=model_id,
            bound_model_kind="small",
        ),
    )
    assert leaf.status_code == 201, leaf.text
    leaf_id = leaf.json()["id"]
    return top_id, mid_id, leaf_id, model_id


async def test_get_references_endpoint_with_bound_model(
    admin_client: AsyncClient, db_session_factory
) -> None:
    """GET /tags/{id}/references:返回 model 引用 + can_delete=false / can_deactivate=true。"""
    _top, _mid, leaf_id, _ = await _make_tag_chain_with_bound_model(
        admin_client, db_session_factory, prefix="refs1"
    )

    r = await admin_client.get(f"/api/v1/tags/{leaf_id}/references")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tag_id"] == leaf_id
    assert body["tag_level"] == TAG_LEVEL_LEAF
    assert "/" in body["tag_path"]  # 含完整路径
    assert len(body["models"]) == 1
    assert body["models"][0]["model_name"] == "test_small_1"
    assert body["total_references"] == 1
    # 模型绑定 → can_delete=false,但 can_deactivate=true(无 active 策略引用)
    assert body["can_delete"] is False
    assert body["can_deactivate"] is True


async def test_get_references_endpoint_no_refs(
    admin_client: AsyncClient
) -> None:
    """无任何引用:can_delete=true / can_deactivate=true。"""
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="no_refs_top", name="no_refs", level=TAG_LEVEL_TOP
        ),
    )
    assert top.status_code == 201, top.text
    top_id = top.json()["id"]

    r = await admin_client.get(f"/api/v1/tags/{top_id}/references")
    assert r.status_code == 200
    body = r.json()
    assert body["strategies"] == []
    assert body["models"] == []
    assert body["can_delete"] is True
    assert body["can_deactivate"] is True
    assert body["total_references"] == 0


async def test_delete_blocked_by_model_binding(
    admin_client: AsyncClient, db_session_factory
) -> None:
    """DELETE 触发 409:模型绑定未解除 → 返回 references 清单。"""
    _top, _mid, leaf_id, _ = await _make_tag_chain_with_bound_model(
        admin_client, db_session_factory, prefix="del_blocked"
    )

    r = await admin_client.delete(f"/api/v1/tags/{leaf_id}")
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["message"]
    assert detail["references"]["tag_id"] == leaf_id
    assert len(detail["references"]["models"]) == 1


async def test_delete_allowed_when_no_references(
    admin_client: AsyncClient
) -> None:
    """无任何引用 → DELETE 204。"""
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="del_ok_top", name="del_ok", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]

    r = await admin_client.delete(f"/api/v1/tags/{top_id}")
    assert r.status_code == 204, r.text

    # 验证已软删除
    g = await admin_client.get(f"/api/v1/tags/{top_id}", params={"include_deleted": "true"})
    assert g.status_code == 200
    assert g.json()["status"] == "deprecated"


async def test_deprecate_allowed_when_no_active_strategy(
    admin_client: AsyncClient
) -> None:
    """无 active 策略引用 → deprecate 200。"""
    top = await admin_client.post(
        "/api/v1/tags",
        json=await _make_tag_payload(
            code="dep_ok", name="dep_ok", level=TAG_LEVEL_TOP
        ),
    )
    top_id = top.json()["id"]

    r = await admin_client.post(f"/api/v1/tags/{top_id}/deprecate")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "deprecated"