"""ImageSet API smoke tests.

Includes route registration and schema checks (sync). End-to-end HTTP
exercises are run via a sibling script ``scripts/verify_imagesets.sh`` to
sidestep pytest-asyncio + TestClient + asyncpg event-loop conflicts in
Python 3.14. Run pytest for the unit-style checks, then the script for
the full flow.
"""
import app.models  # noqa: F401
from app.main import app


def test_imagesets_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/imagesets",
        "/api/v1/imagesets/{imageset_id}",
        "/api/v1/imagesets/{imageset_id}/items",
    ):
        assert key in paths, f"missing route: {key}"


def test_imageset_schemas_present():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in ("ImageSetOut", "ImageSetCreate", "ImageSetUpdate", "ImageSetItemOut"):
        assert s in schemas, f"missing schema: {s}"


def test_ignore_toggle_schema_present():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/imagesets/{imageset_id}/ignore" in paths
    schemas = schema["components"]["schemas"]
    assert "IgnoreToggleRequest" in schemas
    assert "IgnoreToggleResponse" in schemas


def test_models_registered():
    from app.models import ImageSet, ImageSetItem, ImageSetKind
    assert ImageSet.__tablename__ == "image_sets"
    assert ImageSetItem.__tablename__ == "image_set_items"
    assert ImageSetKind.BLACKLIST.value == "黑名单"
    assert ImageSetKind.WHITELIST.value == "白名单"

