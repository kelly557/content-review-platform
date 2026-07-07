"""Library v3 (groups + libraries + items) tests.

Schema-level and route-registration checks only. End-to-end exercises live
in scripts/verify_libraries.sh to avoid the asyncpg+TestClient conflict on
Python 3.14.
"""
import app.models  # noqa: F401
from app.main import app
from app.models.library import Library, LibraryType
from app.models.library_group import LibraryGroup
from app.models.library_item import LibraryItem
from app.models.library_item_reference import LibraryItemReference


def test_library_type_enum_values():
    assert LibraryType.WORD.value == "word"
    assert LibraryType.IMAGE.value == "image"


def test_models_registered():
    assert LibraryGroup.__tablename__ == "library_groups"
    assert Library.__tablename__ == "libraries"
    assert LibraryItem.__tablename__ == "library_items"
    assert LibraryItemReference.__tablename__ == "library_item_references"


def test_library_group_columns():
    cols = {c.name for c in LibraryGroup.__table__.columns}
    for col in ("name", "sort_order", "is_deleted", "deleted_at"):
        assert col in cols, f"missing column: {col}"


def test_library_columns():
    cols = {c.name for c in Library.__table__.columns}
    for col in ("code", "name", "library_type", "group_id", "is_active", "is_deleted"):
        assert col in cols, f"missing column: {col}"


def test_library_item_columns():
    cols = {c.name for c in LibraryItem.__table__.columns}
    for col in ("library_id", "word", "storage_key", "sha256", "is_deleted"):
        assert col in cols, f"missing column: {col}"


def test_libraries_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/library-groups",
        "/api/v1/library-groups/{group_id}",
        "/api/v1/libraries",
        "/api/v1/libraries/{library_id}",
        "/api/v1/libraries/{library_id}/items",
        "/api/v1/libraries/{library_id}/items/batch-delete",
        "/api/v1/libraries/{library_id}/upload",
        "/api/v1/libraries/{library_id}/references",
    ):
        assert key in paths, f"missing route: {key}"


def test_library_schemas_present():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in (
        "LibraryGroupOut",
        "LibraryGroupCreate",
        "LibraryGroupUpdate",
        "LibraryOut",
        "LibraryListItem",
        "LibraryCreate",
        "LibraryUpdate",
        "LibraryDeletePayload",
        "LibraryDeleteResponse",
        "LibraryItemOut",
        "LibraryItemCreate",
        "LibraryItemUpdate",
        "LibraryImageUploadResponse",
        "AuditPointRef",
    ):
        assert s in schemas, f"missing schema: {s}"


def test_legacy_wordsets_routes_still_registered():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/wordsets" in paths
    assert "/api/v1/wordsets/{wordset_id}" in paths


def test_legacy_imagesets_routes_still_registered():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/imagesets" in paths
    assert "/api/v1/imagesets/{imageset_id}" in paths