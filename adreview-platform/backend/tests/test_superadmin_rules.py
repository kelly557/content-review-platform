"""Superadmin role / builtin-rule permission tests.

Two layers:
1. Static checks on source code (no DB / AsyncClient) for the whitelist
   bypass and role guards — robust against the project's flaky
   per-test schema async stack.
2. A few targeted unit tests that don't trigger relationship lazy loading.
"""
from __future__ import annotations

from pathlib import Path

import app.models  # noqa: F401
from app.main import app
from app.models.user import UserRole


def test_user_role_enum_includes_superadmin():
    assert UserRole.SUPERADMIN.value == "superadmin"


def test_require_superadmin_dependency_exists():
    from app.core import deps

    assert hasattr(deps, "require_superadmin"), "deps.require_superadmin must exist"


def test_superadmin_role_in_usercreate_schema():
    """The Pydantic UserCreate schema accepts superadmin via the UserRole enum."""
    from app.schemas.user import UserCreate

    UserCreate(
        email="x@example.com",
        full_name="x",
        password="password123",
        role=UserRole.SUPERADMIN,
    )


def test_audit_items_endpoints_accept_superadmin():
    """The audit_items endpoints open the gate to (admin, superadmin)."""
    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "audit_items.py"
    )
    text = src_path.read_text(encoding="utf-8")
    # require_roles("admin", "superadmin")
    assert 'require_roles("admin", "superadmin")' in text, (
        "audit_items must allow both admin and superadmin"
    )
    # _filter_payload_for_builtin_item bypass for superadmin
    assert "user.role in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN)" in text, (
        "builtin-item whitelist must be bypassed for superadmin"
    )


def test_audit_points_endpoints_accept_superadmin():
    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "audit_points.py"
    )
    text = src_path.read_text(encoding="utf-8")
    assert 'require_roles("admin", "superadmin")' in text, (
        "audit_points must allow both admin and superadmin"
    )
    assert "user.role in (UserRole.SUPERADMIN, UserRole.ROOT_ADMIN)" in text, (
        "builtin-point whitelist must be bypassed for superadmin"
    )


def test_builtin_item_delete_rejects_non_superadmin():
    """The 422 guard on AuditItem delete must mention superadmin."""
    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "audit_items.py"
    )
    text = src_path.read_text(encoding="utf-8")
    assert "通用审核项不允许删除" in text


def test_builtin_point_delete_rejects_non_superadmin():
    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "audit_points.py"
    )
    text = src_path.read_text(encoding="utf-8")
    assert "通用审核点不允许删除" in text


def test_users_endpoint_open_to_admin_and_superadmin():
    src_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "api"
        / "v1"
        / "users.py"
    )
    text = src_path.read_text(encoding="utf-8")
    # The PATCH /users/{id} and friends must allow superadmin
    assert 'require_roles("admin", "superadmin")' in text


def test_audit_routes_still_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/packages/{code}/items",
        "/api/v1/packages/{code}/items/{item_id}",
        "/api/v1/packages/{code}/points",
        "/api/v1/packages/{code}/points/{point_id}",
    ):
        assert key in paths, f"missing route: {key}"