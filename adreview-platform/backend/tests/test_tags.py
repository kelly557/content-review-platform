"""Tag management API smoke tests (CRUD-only)."""
from __future__ import annotations

import pytest

import app.models  # noqa: F401
from app.main import app


EXPECTED_PATHS = (
    "/api/v1/tags",
    "/api/v1/tags/{tag_id}",
    "/api/v1/tags/{tag_id}/activate",
    "/api/v1/tags/{tag_id}/deprecate",
)


EXPECTED_SCHEMAS = (
    "TagOut",
    "TagCreate",
    "TagUpdate",
    "TagSummary",
)


def test_tag_routes_registered():
    paths = app.openapi()["paths"]
    for p in EXPECTED_PATHS:
        assert p in paths, f"missing route: {p}"


def test_tag_schemas_present():
    schemas = app.openapi()["components"]["schemas"]
    for s in EXPECTED_SCHEMAS:
        assert s in schemas, f"missing schema: {s}"


def test_engine_routes_removed():
    """The P0 simplification removes the hit engine; its routes must not exist."""
    paths = app.openapi()["paths"]
    for p in (
        "/api/v1/tags/resolve",
        "/api/v1/tags/{tag_id}/feedback",
        "/api/v1/tags/{tag_id}/hits",
        "/api/v1/tags/hits/by-source",
    ):
        assert p not in paths, f"engine route should be removed: {p}"


def test_engine_schemas_removed():
    schemas = app.openapi()["components"]["schemas"]
    for s in (
        "HitRuleCreate",
        "HitRuleOut",
        "ResolveRequest",
        "ResolveResponse",
        "MatchedTag",
        "MatchedRule",
        "NegativeSampleCreate",
        "NegativeSampleOut",
        "TagHitOut",
    ):
        assert s not in schemas, f"engine schema should be removed: {s}"