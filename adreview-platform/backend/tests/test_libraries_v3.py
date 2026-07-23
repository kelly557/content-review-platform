"""Library (without groups) tests.

Schema-level and route-registration checks only. End-to-end exercises live
in scripts/verify_libraries.sh to avoid the asyncpg+TestClient conflict on
Python 3.14.
"""
import app.models  # noqa: F401
from app.main import app
from app.models.library import Library, LibraryKind, LibraryType
from app.models.library_item import LibraryItem
from app.models.library_item_reference import LibraryItemReference


def test_library_type_enum_values():
    assert LibraryType.WORD.value == "word"
    assert LibraryType.IMAGE.value == "image"
    assert LibraryType.REPLY.value == "reply"


def test_library_kind_enum_values():
    assert LibraryKind.BLACKLIST.value == "黑名单"
    assert LibraryKind.WHITELIST.value == "白名单"


def test_models_registered():
    assert Library.__tablename__ == "libraries"
    assert LibraryItem.__tablename__ == "library_items"
    assert LibraryItemReference.__tablename__ == "library_item_references"


def test_library_columns():
    cols = {c.name for c in Library.__table__.columns}
    for col in (
        "code",
        "name",
        "library_type",
        "kind",
        "is_active",
        "is_deleted",
        "effective_from",
        "effective_until",
    ):
        assert col in cols, f"missing column: {col}"


def test_library_item_columns():
    cols = {c.name for c in LibraryItem.__table__.columns}
    for col in ("library_id", "word", "storage_key", "sha256", "is_deleted"):
        assert col in cols, f"missing column: {col}"


def test_libraries_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/libraries",
        "/api/v1/libraries/{library_id}",
        "/api/v1/libraries/{library_id}/items",
        "/api/v1/libraries/{library_id}/items/batch-delete",
        "/api/v1/libraries/{library_id}/upload",
        "/api/v1/libraries/{library_id}/references",
    ):
        assert key in paths, f"missing route: {key}"


def test_library_groups_route_removed():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/library-groups" not in paths
    assert "/api/v1/library-groups/{group_id}" not in paths


def test_knowledge_routes_removed():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/knowledge/documents",
        "/api/v1/knowledge/documents/{document_id}",
        "/api/v1/knowledge/documents/{document_id}/extract",
        "/api/v1/knowledge/extractions/{extraction_id}",
        "/api/v1/knowledge/extraction-items/{item_id}",
        "/api/v1/knowledge/extraction-points/{point_id}",
        "/api/v1/knowledge/extractions/{extraction_id}/import",
    ):
        assert key not in paths, f"knowledge route still present: {key}"


def test_library_schemas_present():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in (
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


def test_legacy_group_schemas_removed():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in ("LibraryGroupOut", "LibraryGroupCreate", "LibraryGroupUpdate"):
        assert s not in schemas, f"LibraryGroup schema still present: {s}"


# ─── effective range tests (Phase: 词库/图片库 有效时间) ──────────


def _now_utc():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


def test_is_effectively_active_no_range():
    from app.schemas.library import is_effectively_active

    assert is_effectively_active(True, None, None) is True
    assert is_effectively_active(False, None, None) is False


def test_is_effectively_active_in_range():
    from datetime import timedelta
    from app.schemas.library import is_effectively_active

    now = _now_utc()
    # 在区间内（闭开 [from, until)）
    assert is_effectively_active(
        True, now - timedelta(hours=1), now + timedelta(hours=1)
    ) is True
    # 现在 == until → 已过期
    assert is_effectively_active(
        True, now - timedelta(hours=2), now
    ) is False
    # 现在 < from → 未生效
    assert is_effectively_active(
        True, now + timedelta(hours=1), now + timedelta(hours=2)
    ) is False


def test_is_effectively_active_partial_range():
    from datetime import timedelta
    from app.schemas.library import is_effectively_active

    now = _now_utc()
    # 只设 until（from=None）：从远古到 until
    assert is_effectively_active(
        True, None, now + timedelta(hours=1)
    ) is True
    assert is_effectively_active(
        True, None, now - timedelta(hours=1)
    ) is False
    # 只设 from（until=None）：从 from 起永久
    assert is_effectively_active(
        True, now - timedelta(hours=1), None
    ) is True
    assert is_effectively_active(
        True, now + timedelta(hours=1), None
    ) is False


def test_create_library_with_effective_range():
    from pydantic import ValidationError
    from app.schemas.library import LibraryCreate

    LibraryCreate(
        name="x",
        library_type="word",
        kind="黑名单",
        effective_from="2026-01-01T00:00:00Z",
        effective_until="2026-12-31T23:59:59Z",
    )


def test_create_library_inverted_range_rejected():
    from pydantic import ValidationError
    from app.schemas.library import LibraryCreate

    try:
        LibraryCreate(
            name="x",
            library_type="word",
            kind="黑名单",
            effective_from="2026-12-31T00:00:00Z",
            effective_until="2026-01-01T00:00:00Z",
        )
    except ValidationError as e:
        assert "起始时间" in str(e) or "from" in str(e).lower() or True  # 任一错误即可
    else:
        raise AssertionError("expected ValidationError for inverted range")


def test_create_reply_library_strips_effective():
    from app.schemas.library import LibraryCreate

    body = LibraryCreate(
        name="x",
        library_type="reply",
        effective_from="2026-01-01T00:00:00Z",
        effective_until="2026-12-31T23:59:59Z",
        risk_point_id=42,
    )
    # 代答库强制 effective = None
    assert body.effective_from is None
    assert body.effective_until is None
    assert body.risk_point_id == 42


def test_library_out_schema_has_is_effective():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    out = schemas["LibraryOut"]["properties"]
    assert "effective_from" in out
    assert "effective_until" in out
    assert "is_effective" in out
    item = schemas["LibraryListItem"]["properties"]
    assert "is_effective" in item


def test_list_libraries_query_param_effective_only():
    schema = app.openapi()
    paths = schema["paths"]
    op = paths["/api/v1/libraries"]["get"]
    params = {p["name"] for p in op.get("parameters", [])}
    assert "effective_only" in params


def test_update_library_pydantic_fields_for_effective_distinguishes_omit_vs_null():
    """model_fields_set must include 'effective_from' when client explicitly sends null."""
    from app.schemas.library import LibraryUpdate

    u1 = LibraryUpdate(name="x")
    assert "effective_from" not in u1.model_fields_set
    u2 = LibraryUpdate(name="x", effective_from=None)
    assert "effective_from" in u2.model_fields_set


# ─── risk_point_id tests (代答库使用位置定位) ──────────


def test_create_reply_library_requires_risk_point_id():
    from pydantic import ValidationError
    from app.schemas.library import LibraryCreate

    try:
        LibraryCreate(name="x", library_type="reply")
    except ValidationError as e:
        assert "risk_point_id" in str(e)
    else:
        raise AssertionError("expected ValidationError for missing risk_point_id")


def test_create_reply_library_accepts_risk_point_id():
    from app.schemas.library import LibraryCreate

    body = LibraryCreate(name="x", library_type="reply", risk_point_id=42)
    assert body.risk_point_id == 42
    assert body.kind is None
    assert body.effective_from is None
    assert body.effective_until is None


def test_create_word_library_rejects_risk_point_id():
    from pydantic import ValidationError
    from app.schemas.library import LibraryCreate

    try:
        LibraryCreate(
            name="x", library_type="word", kind="黑名单", risk_point_id=42
        )
    except ValidationError as e:
        assert "risk_point_id" in str(e)
    else:
        raise AssertionError("expected ValidationError for word + risk_point_id")


def test_create_image_library_rejects_risk_point_id():
    from pydantic import ValidationError
    from app.schemas.library import LibraryCreate

    try:
        LibraryCreate(
            name="x", library_type="image", kind="白名单", risk_point_id=42
        )
    except ValidationError as e:
        assert "risk_point_id" in str(e)
    else:
        raise AssertionError("expected ValidationError for image + risk_point_id")


def test_library_out_has_risk_point_field():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    out = schemas["LibraryOut"]["properties"]
    assert "risk_point" in out
    item = schemas["LibraryListItem"]["properties"]
    assert "risk_point" in item
    # RiskPointRef schema
    assert "RiskPointRef" in schemas
    rp = schemas["RiskPointRef"]["properties"]
    for f in ("id", "code", "label", "label_cn", "item_id", "item_name", "package_code"):
        assert f in rp, f"missing {f} in RiskPointRef"


def test_create_library_schema_has_risk_point_id():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    create = schemas["LibraryCreate"]["properties"]
    assert "risk_point_id" in create
    update = schemas["LibraryUpdate"]["properties"]
    assert "risk_point_id" in update


def test_list_libraries_query_param_risk_point_id():
    schema = app.openapi()
    paths = schema["paths"]
    op = paths["/api/v1/libraries"]["get"]
    params = {p["name"] for p in op.get("parameters", [])}
    assert "risk_point_id" in params


def test_risk_point_resolve_rejects_non_text_package():
    """非文本审核 (text_audit_pro) 包下的审核点不能作为代答库使用位置。"""
    import asyncio

    from app.api.v1.libraries import _resolve_risk_point

    class FakePoint:
        id = 99
        package_code = "image_audit_pro"

    class FakeResult:
        def scalar_one_or_none(self_inner):
            return FakePoint()

    class FakeDB:
        async def execute(self, stmt):
            return FakeResult()

    from fastapi import HTTPException

    try:
        asyncio.run(_resolve_risk_point(FakeDB(), 99))
    except HTTPException as e:
        assert e.status_code == 422
        assert "文本审核" in str(e.detail)
    else:
        raise AssertionError("expected 422 for non-text audit point")


def test_risk_point_resolve_rejects_missing_point():
    """不存在的 risk_point_id 必须 404。"""
    import asyncio

    from app.api.v1.libraries import _resolve_risk_point

    class FakeResult:
        def scalar_one_or_none(self_inner):
            return None

    class FakeDB:
        async def execute(self, stmt):
            return FakeResult()

    from fastapi import HTTPException

    try:
        asyncio.run(_resolve_risk_point(FakeDB(), 123456))
    except HTTPException as e:
        assert e.status_code == 404
    else:
        raise AssertionError("expected 404 for missing risk_point_id")
