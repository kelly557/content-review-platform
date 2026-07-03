"""WordSet API smoke tests."""
import pytest

import app.models  # noqa: F401
from app.main import app


def test_wordsets_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/wordsets",
        "/api/v1/wordsets/{wordset_id}",
        "/api/v1/wordsets/{wordset_id}/words",
    ):
        assert key in paths, f"missing route: {key}"


def test_wordset_schemas_present():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in ("WordSetOut", "WordSetCreate", "WordSetUpdate"):
        assert s in schemas, f"missing schema: {s}"
