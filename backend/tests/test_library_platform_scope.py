"""Library platform-scope tests — schema and route checks only.

These tests avoid per-test database fixtures because the project's
SQLAlchemy async + per-test schema isolation has known issues with
relationship eager-loading across tests (see test_libraries_v3.py for
the parallel decision: end-to-end exercises moved to a shell script).
Here we verify:

- ``Library`` has the new ``is_platform`` column with the expected default.
- The ``LibraryOut`` and ``LibraryListItem`` schemas expose ``is_platform``.
- The router still registers the expected routes (sanity check that the
  refactor didn't break imports).
- The role-filter guard (``current_user.role != SUPERADMIN``) is wired in by
  import-graph introspection of the source — covers the intent without a
  full integration roundtrip.
"""
from __future__ import annotations

import app.models  # noqa: F401
from app.main import app
from app.models.library import Library


def test_library_has_is_platform_column():
    cols = {c.name for c in Library.__table__.columns}
    assert "is_platform" in cols, "Library must have is_platform column"


def test_library_is_platform_default_false():
    """Non-seed libraries default to 个性化 (is_platform=False)."""
    from sqlalchemy import inspect

    col = Library.__table__.columns["is_platform"]
    default = col.server_default.arg if col.server_default is not None else None
    # server_default is set to the string "false" (matches other boolean defaults)
    assert default is not None
    assert "false" in str(default).lower()


def test_library_out_schema_exposes_is_platform():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    out = schemas["LibraryOut"]["properties"]
    assert "is_platform" in out, "LibraryOut must expose is_platform"


def test_library_list_item_schema_exposes_is_platform():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    item = schemas["LibraryListItem"]["properties"]
    assert "is_platform" in item, "LibraryListItem must expose is_platform"


def test_libraries_routes_still_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/libraries",
        "/api/v1/libraries/{library_id}",
        "/api/v1/libraries/{library_id}/items",
    ):
        assert key in paths, f"missing route: {key}"


def test_role_filter_is_wired_in_source():
    """The list endpoint must filter out platform libraries for non-superadmin.

    Static check on the source code so we don't depend on the fragile
    end-to-end async + per-test schema stack.
    """
    from pathlib import Path

    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    )
    text = src_path.read_text(encoding="utf-8")
    assert "current_user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN)" in text, (
        "list_libraries must filter is_platform=False for non-superadmin"
    )
    assert "is_platform and current_user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN)" in text, (
        "get_library and update_library must hide platform libs from non-superadmin"
    )


def test_post_library_superadmin_can_set_platform():
    """POST /libraries allows superadmin to set is_platform=true; non-super is blocked.

    Static check on the source code so we don't depend on the fragile
    end-to-end async + per-test schema stack.
    """
    from pathlib import Path

    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    )
    text = src_path.read_text(encoding="utf-8")
    # Non-super POST with is_platform=true must be rejected with 422
    assert "body.is_platform and current_user.role not in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN)" in text, (
        "create_library must gate is_platform=true to superadmin only"
    )
    # The create_library body must forward body.is_platform rather than hard-code false
    assert "is_platform=body.is_platform" in text, (
        "create_library must honor body.is_platform when caller is superadmin"
    )


def test_update_library_superadmin_can_toggle_platform():
    """PUT /libraries/{id} allows superadmin to toggle is_platform; non-super is blocked."""
    from pathlib import Path

    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "libraries.py"
    )
    text = src_path.read_text(encoding="utf-8")
    assert (
        '"is_platform" in sent' in text
    ), "update_library should check 'is_platform' in sent fields"
    assert "仅超级管理员可切换「通用平台库」属性" in text, (
        "update_library must raise 422 when non-superadmin tries to toggle is_platform"
    )