"""WordSet v2 (group + action) tests.

These verify the new two-axis taxonomy without depending on the runtime
DB: schema/enum/route-level checks only.
"""
import pytest

import app.models  # noqa: F401
from app.main import app
from app.models.wordset import WordSet, WordSetAction, WordSetGroup
from app.schemas.wordset import WordSetCreate, WordSetOut, WordSetUpdate


# ---------- enum ----------


def test_wordset_group_enum_values():
    assert WordSetGroup.SENSITIVE.value == "敏感词"
    assert WordSetGroup.AD.value == "广告法"
    assert WordSetGroup.BRAND.value == "品牌"
    assert WordSetGroup.INDUSTRY.value == "行业"
    assert WordSetGroup.COMPLIANCE.value == "合规"
    assert WordSetGroup.KEYWORD.value == "关键词"
    assert WordSetGroup.INVENTORY.value == "清单"
    assert WordSetGroup.CUSTOM.value == "自定义"


def test_wordset_action_enum_values():
    assert WordSetAction.BLOCK.value == "黑名单"
    assert WordSetAction.ALLOW.value == "白名单"
    assert WordSetAction.REVIEW.value == "需复审"
    assert WordSetAction.TAG.value == "标签"


# ---------- model ----------


def test_wordset_model_columns_present():
    cols = {c.name for c in WordSet.__table__.columns}
    for col in ("group", "action", "name", "is_active", "ignored_services"):
        assert col in cols, f"missing column: {col}"


# ---------- schema ----------


def test_wordset_create_schema_accepts_group_and_action():
    payload = WordSetCreate(
        name="QA 词集",
        group=WordSetGroup.SENSITIVE,
        action=WordSetAction.BLOCK,
        words=["foo"],
    )
    assert payload.group == WordSetGroup.SENSITIVE
    assert payload.action == WordSetAction.BLOCK
    assert payload.words == ["foo"]


def test_wordset_create_schema_defaults():
    """group 默认 '关键词'，action 默认 '黑名单'，words 默认 []。"""
    payload = WordSetCreate(name="默认集")
    assert payload.group == WordSetGroup.KEYWORD
    assert payload.action == WordSetAction.BLOCK
    assert payload.words == []


def test_wordset_update_schema_optional_fields():
    u = WordSetUpdate(name="改", group=WordSetGroup.BRAND, action=WordSetAction.ALLOW)
    assert u.name == "改"
    assert u.group == WordSetGroup.BRAND
    assert u.action == WordSetAction.ALLOW


# ---------- api routes ----------


def test_wordsets_routes_still_registered_v2():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/wordsets" in paths
    assert "/api/v1/wordsets/{wordset_id}" in paths
    assert "/api/v1/wordsets/{wordset_id}/words" in paths
    assert "/api/v1/wordsets/{wordset_id}/ignore" in paths


def test_wordsets_schemas_expose_group_and_action():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    out = schemas["WordSetOut"]["properties"]
    assert "group" in out
    assert "action" in out
    create = schemas["WordSetCreate"]["properties"]
    assert "group" in create
    assert "action" in create
    update = schemas["WordSetUpdate"]["properties"]
    assert "group" in update
    assert "action" in update
