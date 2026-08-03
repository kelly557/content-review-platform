"""Library tag binding (level 1 / level 2) — schema, OpenAPI, and source checks.

The matcher-side label_cn behavior is covered in test_wordset_matcher.py;
this file covers:

- ``LibraryCreate`` / ``LibraryUpdate`` / ``LibraryBatchItem`` expose ``tag_id``
  as an optional string field.
- The OpenAPI document surfaces ``tag_id`` as an optional string on those
  three schemas + the response schemas (``Library.tag``, ``LibraryListItem.tag``).
- ``TagRefBrief`` schema contains the four expected fields.
- ``_resolve_library_tag`` in the libraries router rejects level=3 tags.

These are static / OpenAPI-level checks so the suite does not depend on the
per-test async DB stack.
"""
from __future__ import annotations

import app.models  # noqa: F401
from app.main import app
from app.schemas.library import (
    LibraryBatchItem,
    LibraryCreate,
    LibraryListItem,
    LibraryOut,
    LibraryUpdate,
    TagRefBrief,
)


def test_tag_ref_brief_shape():
    fields = TagRefBrief.model_fields
    for k in ("id", "name", "level", "path"):
        assert k in fields, f"TagRefBrief missing field: {k}"


def test_library_create_exposes_tag_id():
    fields = LibraryCreate.model_fields
    assert "tag_id" in fields, "LibraryCreate must expose tag_id"
    assert fields["tag_id"].default is None


def test_library_update_exposes_tag_id():
    fields = LibraryUpdate.model_fields
    assert "tag_id" in fields, "LibraryUpdate must expose tag_id"
    assert fields["tag_id"].default is None


def test_library_batch_item_exposes_tag_id():
    fields = LibraryBatchItem.model_fields
    assert "tag_id" in fields, "LibraryBatchItem must expose tag_id"


def test_library_out_exposes_tag_field():
    fields = LibraryOut.model_fields
    assert "tag" in fields, "LibraryOut must expose tag"
    assert fields["tag"].default is None


def test_library_list_item_exposes_tag_field():
    fields = LibraryListItem.model_fields
    assert "tag" in fields, "LibraryListItem must expose tag"
    assert fields["tag"].default is None


def test_openapi_create_payload_includes_tag_id():
    schema = app.openapi()
    create = schema["components"]["schemas"]["LibraryCreate"]["properties"]
    assert "tag_id" in create
    # Optional[str] → anyOf [{type:string}, {type:null}]
    shape = create["tag_id"]
    types = {sub.get("type") for sub in shape.get("anyOf", [])}
    assert "string" in types and "null" in types


def test_openapi_update_payload_includes_tag_id():
    schema = app.openapi()
    upd = schema["components"]["schemas"]["LibraryUpdate"]["properties"]
    assert "tag_id" in upd
    shape = upd["tag_id"]
    types = {sub.get("type") for sub in shape.get("anyOf", [])}
    assert "string" in types and "null" in types


def test_openapi_response_surfaces_tag():
    schema = app.openapi()
    out = schema["components"]["schemas"]["LibraryOut"]["properties"]
    list_item = schema["components"]["schemas"]["LibraryListItem"]["properties"]
    assert "tag" in out
    assert "tag" in list_item
    # tag 是 nullable $ref: anyOf [{$ref: TagRefBrief}, {type: null}]
    for props in (out["tag"], list_item["tag"]):
        assert "anyOf" in props
        refs = [sub.get("$ref") for sub in props["anyOf"]]
        types = [sub.get("type") for sub in props["anyOf"]]
        assert any(r and r.endswith("/TagRefBrief") for r in refs)
        assert "null" in types


def test_router_rejects_level_3_tag():
    """服务端 _resolve_library_tag 必须拒绝 level=3 (三级保留给模型绑定)。"""
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    ).read_text(encoding="utf-8")

    # 函数存在
    assert "async def _resolve_library_tag" in src
    # level=1/2 接受、level=3 拒绝
    assert "TAG_LEVEL_TOP, TAG_LEVEL_MID" in src
    assert "词库/代答库只能绑定一级或二级风险标签" in src
    # 404 路径
    assert "风险标签不存在" in src


def test_router_creates_library_tag_row():
    """POST /libraries 与 batch-create 都应把 tag_id 落成 LibraryTag 行。"""
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    ).read_text(encoding="utf-8")

    assert "from app.models.library_tag import LibraryTag" in src
    assert "db.add(LibraryTag(library_id=lib.id, tag_id=bound_tag.id))" in src


def test_router_update_unbinds_when_tag_id_is_null():
    """PUT /libraries/{id} 把 tag_id 显式置为 null 时应解绑 (删行)。"""
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    ).read_text(encoding="utf-8")

    assert '"tag_id" in sent' in src
    # 删行调用是 multi-line, 改为子串匹配
    assert "LibraryTag.__table__.delete().where(" in src
    assert "LibraryTag.library_id == lib.id" in src


def test_platform_library_allows_tag_id_edit():
    """通用平台库白名单应允许非超管编辑 tag_id (业务配置,非结构变更)。"""
    import re

    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    ).read_text(encoding="utf-8")

    assert '"tag_id"' in src
    # 白名单是 frozenset({...}) — 用 regex 切出大括号段,验证包含 "tag_id"
    m = re.search(
        r"PLATFORM_LIBRARY_WRITABLE_FIELDS\s*=\s*frozenset\(\s*\{([^}]*)\}\s*\)",
        src,
        re.DOTALL,
    )
    assert m is not None, "could not find PLATFORM_LIBRARY_WRITABLE_FIELDS set literal"
    set_body = m.group(1)
    assert '"tag_id"' in set_body, "PLATFORM_LIBRARY_WRITABLE_FIELDS must include tag_id"


def test_wordset_matcher_uses_tag_path_as_prefix():
    """matcher _build_hit 必须把 tag.path 拼到 label_cn 前缀。"""
    from pathlib import Path

    src = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "services"
        / "wordset_matcher.py"
    ).read_text(encoding="utf-8")

    assert "tag['path']" in src
    assert "_LIBRARY_KIND_LABEL" in src
    assert '"自定义黑名单库"' in src
    assert '"自定义白名单库"' in src
