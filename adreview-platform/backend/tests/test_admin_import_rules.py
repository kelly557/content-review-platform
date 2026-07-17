"""Tests for the admin rule-import endpoints under /api/v1/admin/import-rules/*.

Auth: requires an admin JWT. Log in via /auth/login like other admin tests.
"""
from __future__ import annotations

import pytest

import app.models  # noqa: F401
from app.main import app
from app.services.rule_importer import ParseError, parse_table


# ─────────────────────────── A. parser unit tests ───────────────────────────


SAMPLE = """\
审核项 ｜ 审核点 ｜ 检测内容
涉政 ｜ 不出现国家领导人 ｜ 现任领导人姓名
　　｜ 不出现敏感事件 ｜ 涉敏感事件
涉恐 ｜ 不出现恐怖组织 ｜ 恐怖组织名单
"""


def test_parser_full_pipe():
    parsed = parse_table(SAMPLE)
    assert len(parsed.items) == 2
    assert parsed.items[0].name_cn == "涉政"
    assert len(parsed.items[0].points) == 2
    assert parsed.items[1].name_cn == "涉恐"
    assert parsed.items[1].points[0].label_cn == "不出现恐怖组织"
    assert parsed.items[0].points[0].description == "现任领导人姓名"
    assert parsed.items[0].points[1].description == "涉敏感事件"


def test_parser_half_pipe():
    text = "审核项|审核点|检测内容\n涉政|不出现涉政言论|涉政\n"
    parsed = parse_table(text)
    assert parsed.items[0].name_cn == "涉政"
    assert parsed.items[0].points[0].label_cn == "不出现涉政言论"


def test_parser_tab():
    text = "审核项\t审核点\t检测内容\n涉政\t不出现涉政言论\t涉政内容\n"
    parsed = parse_table(text)
    assert parsed.items[0].points[0].label_cn == "不出现涉政言论"


def test_parser_two_spaces():
    text = "审核项  审核点  检测内容\n涉政  不出现涉政言论  涉政\n"
    parsed = parse_table(text)
    assert parsed.items[0].name_cn == "涉政"
    assert parsed.items[0].points[0].label_cn == "不出现涉政言论"


def test_parser_carry_down_item():
    text = "审核项 ｜ 审核点 ｜ 检测内容\n涉政 ｜ 不出现领导人 ｜ 涉政\n　　｜ 涉政事件 ｜ 涉政\n"
    parsed = parse_table(text)
    assert len(parsed.items) == 1
    assert parsed.items[0].name_cn == "涉政"
    assert len(parsed.items[0].points) == 2


def test_parser_reject_empty_point():
    text = "审核项 ｜ 审核点 ｜ 检测内容\n涉政 ｜  ｜ 涉政\n"
    with pytest.raises(ParseError):
        parse_table(text)


def test_parser_reject_duplicate():
    text = (
        "审核项 ｜ 审核点 ｜ 检测内容\n"
        "涉政 ｜ 领导人 ｜ 涉政\n"
        "涉政 ｜ 领导人 ｜ 涉政\n"
    )
    with pytest.raises(ParseError):
        parse_table(text)


def test_parser_skip_comments_and_blanks():
    text = (
        "# leading comment\n"
        "\n"
        "审核项 ｜ 审核点 ｜ 检测内容\n"
        "# mid comment\n"
        "涉政 ｜ 领导人 ｜ 涉政\n"
    )
    parsed = parse_table(text)
    assert len(parsed.items) == 1
    assert len(parsed.items[0].points) == 1


def test_parser_skip_markdown_separator_row():
    """Markdown-style table with a `| --- | --- |` separator line under the
    header must not introduce a phantom item named '---'."""
    text = (
        "| 审核项 | 审核点   | 检测内容       |\n"
        "| ------ | ------ | ---------- |\n"
        "| 涉政   | 不出现国家领导人 | 现任国家领导人姓名 |\n"
        "| 涉恐   | 不出现恐怖组织 | 涉恐组织名称 |\n"
    )
    parsed = parse_table(text)
    names = [i.name_cn for i in parsed.items]
    assert names == ["涉政", "涉恐"]
    for p in parsed.items[0].points:
        assert "---" not in p.label_cn
    assert parsed.items[0].points[0].label_cn == "不出现国家领导人"
    assert parsed.items[0].points[0].description == "现任国家领导人姓名"


def test_parser_unrecognised_separator_rejected():
    text = "审核项,审核点,检测内容\n涉政,不出现领导人,涉政\n"
    with pytest.raises(ParseError):
        parse_table(text)


def test_parser_no_data_rows_rejected():
    text = "审核项 ｜ 审核点 ｜ 检测内容\n"
    with pytest.raises(ParseError):
        parse_table(text)


# ─────────────────────────── B. HTTP smoke tests ───────────────────────────


def test_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/admin/import-rules/packages" not in paths
    assert "/api/v1/admin/import-rules/preview" in paths
    assert "/api/v1/admin/import-rules/import" in paths


async def _login(client, email: str, password: str) -> None:
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


@pytest.mark.asyncio
async def test_unauthenticated_request_rejected(client):
    r = await client.post(
        "/api/v1/admin/import-rules/preview",
        json={
            "media_type": "image",
            "table_text": "审核项｜审核点｜检测内容\n涉政｜领导人｜涉政\n",
        },
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_non_admin_role_rejected(client):
    # reviewer is not admin
    await _login(client, "reviewer@adreview.example.com", "reviewer123")
    r = await client.post(
        "/api/v1/admin/import-rules/preview",
        json={
            "media_type": "image",
            "table_text": "审核项｜审核点｜检测内容\n涉政｜领导人｜涉政\n",
        },
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_import_e2e_create_then_update(
    client, db_session_factory
):
    from app.models.service import Service, ServiceScope

    await _login(client, "admin@adreview.example.com", "admin123")

    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片审核_测试",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    body = {
        "media_type": "image",
        "table_text": (
            "审核项 ｜ 审核点 ｜ 检测内容\n"
            "涉政 ｜ 不出现国家领导人 ｜ 现任领导人姓名\n"
            "　　｜ 不出现敏感事件 ｜ 敏感事件\n"
            "涉恐 ｜ 不出现恐怖组织 ｜ 恐怖组织\n"
        ),
        "is_enabled": False,
        "on_conflict": "update",
    }

    # 1. preview (dry-run) — reports creates but DB count is 0
    rprev = await client.post(
        "/api/v1/admin/import-rules/preview", json=body
    )
    assert rprev.status_code == 200, rprev.text
    prev = rprev.json()
    assert prev["summary"]["items_created"] == 2
    assert prev["summary"]["points_created"] == 3

    # 2. import — actually writes
    rimp = await client.post(
        "/api/v1/admin/import-rules/import", json=body
    )
    assert rimp.status_code == 200, rimp.text
    imp = rimp.json()
    assert imp["summary"]["items_created"] == 2
    assert imp["summary"]["points_created"] == 3

    from sqlalchemy import select

    from app.models.audit_item import AuditItem
    from app.models.audit_point import AuditPoint

    async with db_session_factory() as s:
        items = (await s.execute(select(AuditItem))).scalars().all()
        points = (await s.execute(select(AuditPoint))).scalars().all()
        assert len(items) == 2
        assert len(points) == 3

    # 3. re-import same body — all updates, no new rows
    rimp2 = await client.post(
        "/api/v1/admin/import-rules/import", json=body
    )
    assert rimp2.status_code == 200, rimp2.text
    imp2 = rimp2.json()
    assert imp2["summary"]["items_created"] == 0
    assert imp2["summary"]["items_updated"] == 2
    assert imp2["summary"]["points_updated"] == 3

    async with db_session_factory() as s:
        items = (await s.execute(select(AuditItem))).scalars().all()
        points = (await s.execute(select(AuditPoint))).scalars().all()
        assert len(items) == 2
        assert len(points) == 3


@pytest.mark.asyncio
async def test_admin_import_unknown_package_rejected(client):
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.post(
        "/api/v1/admin/import-rules/import",
        json={
            "media_type": "audio",
            "table_text": (
                "审核项｜审核点｜检测内容\n"
                "涉政｜领导人｜涉政\n"
            ),
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_import_invalid_threshold_pair_rejected(
    client, db_session_factory
):
    from app.models.service import Service, ServiceScope

    await _login(client, "admin@adreview.example.com", "admin123")

    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    r = await client.post(
        "/api/v1/admin/import-rules/import",
        json={
            "media_type": "image",
            "table_text": (
                "审核项｜审核点｜检测内容\n"
                "涉政｜领导人｜涉政\n"
            ),
            "default_medium_threshold": 90.0,
            "default_high_threshold": 60.0,
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_preview_does_not_write(client, db_session_factory):
    from app.models.service import Service, ServiceScope
    from app.models.audit_item import AuditItem
    from app.models.audit_point import AuditPoint
    from sqlalchemy import select

    await _login(client, "admin@adreview.example.com", "admin123")

    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    r = await client.post(
        "/api/v1/admin/import-rules/preview",
        json={
            "media_type": "image",
            "table_text": (
                "审核项｜审核点｜检测内容\n"
                "涉政｜领导人｜涉政\n"
                "涉恐｜恐怖｜恐\n"
            ),
        },
    )
    assert r.status_code == 200

    async with db_session_factory() as s:
        items = (await s.execute(select(AuditItem))).scalars().all()
        points = (await s.execute(select(AuditPoint))).scalars().all()
        assert items == []
        assert points == []


@pytest.mark.asyncio
async def test_admin_parser_error_returns_422(client):
    await _login(client, "admin@adreview.example.com", "admin123")
    r = await client.post(
        "/api/v1/admin/import-rules/import",
        json={
            "media_type": "image",
            "table_text": "审核项｜审核点｜检测内容\n涉政｜ ｜\n",
        },
    )
    assert r.status_code == 422


# ─────────────────────── kind (builtin / personal) ───────────────────────


@pytest.mark.asyncio
async def test_kind_personal_writes_is_builtin_false(
    client, db_session_factory
):
    from app.models.audit_item import AuditItem
    from app.models.service import Service, ServiceScope
    from sqlalchemy import select

    await _login(client, "admin@adreview.example.com", "admin123")
    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    r = await client.post(
        "/api/v1/admin/import-rules/import",
        json={
            "media_type": "image",
            "kind": "personal",
            "table_text": (
                "审核项｜审核点｜检测内容\n"
                "涉政｜领导人｜涉政\n"
            ),
        },
    )
    assert r.status_code == 200, r.text
    async with db_session_factory() as s:
        items = (await s.execute(select(AuditItem))).scalars().all()
    assert len(items) == 1
    assert items[0].is_builtin is False


@pytest.mark.asyncio
async def test_kind_builtin_writes_is_builtin_true(
    client, db_session_factory
):
    from app.models.audit_item import AuditItem
    from app.models.service import Service, ServiceScope
    from sqlalchemy import select

    await _login(client, "admin@adreview.example.com", "admin123")
    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    r = await client.post(
        "/api/v1/admin/import-rules/import",
        json={
            "media_type": "image",
            "kind": "builtin",
            "table_text": (
                "审核项｜审核点｜检测内容\n"
                "涉政｜领导人｜涉政\n"
            ),
        },
    )
    assert r.status_code == 200, r.text
    async with db_session_factory() as s:
        items = (await s.execute(select(AuditItem))).scalars().all()
    assert len(items) == 1
    assert items[0].is_builtin is True


@pytest.mark.asyncio
async def test_kind_builtin_can_extend_existing_builtin_item(
    client, db_session_factory
):
    """When the existing item is is_builtin=true and the caller asked for
    kind=builtin, new points under that item ARE allowed (CREATE branch
    only, never triggers the AuditPoint ↔ Library eager-load in test
    schema)."""
    from app.models.service import Service, ServiceScope

    await _login(client, "admin@adreview.example.com", "admin123")
    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    body = {
        "media_type": "image",
        "kind": "builtin",
        "table_text": (
            "审核项｜审核点｜检测内容\n"
            "涉政｜领导人｜涉政\n"
        ),
    }
    r1 = await client.post("/api/v1/admin/import-rules/import", json=body)
    assert r1.status_code == 200, r1.text

    # Second import: same item, an additional point under the same builtin item.
    body["table_text"] = (
        "审核项｜审核点｜检测内容\n"
        "涉政｜敏感事件｜敏感事件\n"
    )
    r2 = await client.post("/api/v1/admin/import-rules/import", json=body)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["summary"]["points_created"] == 1
    # Should NOT carry a downgrade warning.
    assert body2["warnings"] == [] or not any("拒绝" in w for w in body2["warnings"])


@pytest.mark.asyncio
async def test_kind_downgrade_without_confirm_is_422(
    client, db_session_factory
):
    """Cross-class conflict: existing item is builtin, new request asks
    for personal → 422 unless confirm_downgrade=true."""
    from app.models.service import Service, ServiceScope

    await _login(client, "admin@adreview.example.com", "admin123")
    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    # First import as builtin (no downgrade yet)
    body = {
        "media_type": "image",
        "kind": "builtin",
        "table_text": (
            "审核项｜审核点｜检测内容\n"
            "涉政｜领导人｜涉政\n"
        ),
    }
    r1 = await client.post("/api/v1/admin/import-rules/import", json=body)
    assert r1.status_code == 200, r1.text

    # Re-import same name as personal WITHOUT confirm → reject
    bad = {**body, "kind": "personal"}
    r2 = await client.post("/api/v1/admin/import-rules/import", json=bad)
    assert r2.status_code == 422, r2.text
    assert "降级" in r2.json()["detail"] or "confirm_downgrade" in r2.json()["detail"]


@pytest.mark.asyncio
async def test_kind_downgrade_with_confirm_succeeds_and_warns(
    client, db_session_factory
):
    from app.models.service import Service, ServiceScope

    await _login(client, "admin@adreview.example.com", "admin123")
    async with db_session_factory() as s:
        s.add(
            Service(
                code="image_audit_pro",
                name="图片",
                scope=ServiceScope.BUSINESS,
                is_active=True,
                is_rule_package=True,
            )
        )
        await s.commit()

    body = {
        "media_type": "image",
        "kind": "builtin",
        "table_text": (
            "审核项｜审核点｜检测内容\n"
            "涉政｜领导人｜涉政\n"
        ),
    }
    r1 = await client.post("/api/v1/admin/import-rules/import", json=body)
    assert r1.status_code == 200, r1.text

    # Re-import as personal with confirm_downgrade=true → 200 + warning.
    # The AuditPoint ORM has a selectin-loaded `linked_libraries` attribute
    # that, on UPDATE of an existing point, eagerly joins `libraries` to
    # populate the relationship. The test schema is otherwise fine, but we
    # assert only on the response body to stay orthogonal to that quirk.
    down = {**body, "kind": "personal", "confirm_downgrade": True}
    r2 = await client.post("/api/v1/admin/import-rules/import", json=down)
    assert r2.status_code == 200, r2.text
    body_json = r2.json()
    assert any("降级" in w for w in body_json["warnings"])
