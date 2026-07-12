"""Library is_platform toggle (superadmin-only) — schema and source checks.

Covers:

- LibraryCreate / LibraryUpdate / LibraryBatchItem expose ``is_platform``.
- The OpenAPI document surfaces ``is_platform`` as a writable boolean.
- ``create_library`` gates ``is_platform=true`` to superadmin only.
- ``update_library`` gates ``is_platform`` toggling to superadmin only.
- ``batch_create_libraries`` also enforces the same gate.

These are static / OpenAPI-level checks so the suite does not depend on the
fragile per-test async DB stack (see test_library_platform_scope.py).
"""
from __future__ import annotations

from pathlib import Path

import app.models  # noqa: F401
from app.main import app
from app.schemas.library import LibraryBatchItem, LibraryCreate, LibraryUpdate


def test_library_create_exposes_is_platform():
    fields = LibraryCreate.model_fields
    assert "is_platform" in fields, "LibraryCreate must expose is_platform"
    assert fields["is_platform"].default is False, (
        "LibraryCreate.is_platform default must be False (向后兼容)"
    )


def test_library_update_exposes_is_platform_optional():
    fields = LibraryUpdate.model_fields
    assert "is_platform" in fields, "LibraryUpdate must expose is_platform"
    assert fields["is_platform"].default is None


def test_library_batch_item_exposes_is_platform():
    fields = LibraryBatchItem.model_fields
    assert "is_platform" in fields, "LibraryBatchItem must expose is_platform"
    assert fields["is_platform"].default is False


def test_openapi_create_payload_includes_is_platform():
    schema = app.openapi()
    create = schema["components"]["schemas"]["LibraryCreate"]["properties"]
    assert "is_platform" in create, (
        "OpenAPI LibraryCreate must surface is_platform as a writable boolean"
    )
    assert create["is_platform"]["type"] == "boolean"


def test_openapi_update_payload_includes_is_platform():
    schema = app.openapi()
    upd = schema["components"]["schemas"]["LibraryUpdate"]["properties"]
    assert "is_platform" in upd
    # Optional[bool] renders as anyOf [{type:boolean}, {type:null}]
    shape = upd["is_platform"]
    types = {sub.get("type") for sub in shape.get("anyOf", [])}
    assert "boolean" in types and "null" in types


def _read_router_source() -> str:
    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    )
    return src_path.read_text(encoding="utf-8")


def test_create_library_source_gates_platform_flag_to_superadmin():
    text = _read_router_source()
    # POST /libraries 内必须出现"非超管带 is_platform=true → 422"的兜底
    assert "body.is_platform and current_user.role != UserRole.SUPERADMIN" in text
    assert "仅超级管理员可将库设为「通用平台库」" in text


def test_create_library_source_forwards_body_is_platform():
    text = _read_router_source()
    # 新行为:超管调用时透传 body.is_platform,而非 hard-code False
    assert "is_platform=body.is_platform" in text


def test_update_library_source_gates_platform_flag_to_superadmin():
    text = _read_router_source()
    assert '"is_platform" in sent' in text
    assert "仅超级管理员可切换「通用平台库」属性" in text


def test_batch_create_libraries_source_gates_platform_flag_to_superadmin():
    text = _read_router_source()
    # batch-create 路径里也要有"非超管带 is_platform=true → 拒绝"的兜底
    assert "item.is_platform and current_user.role != UserRole.SUPERADMIN" in text
    # batch-create 创建 Library 时使用 item.is_platform 而非 hard-code False
    assert "is_platform=item.is_platform" in text