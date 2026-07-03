"""DetectionRule API smoke tests."""
import pytest

import app.models  # noqa: F401
from app.main import app


def test_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/services/{service_code}/rules",
        "/api/v1/services/{service_code}/rules/{label}",
        "/api/v1/services/{service_code}/rules/reset",
        "/api/v1/services/{service_code}/rules/wordsets",
        "/api/v1/services/{service_code}/human-review",
    ):
        assert key in paths, f"missing route: {key}"


def test_schemas_present():
    schema = app.openapi()
    schemas = schema["components"]["schemas"]
    for s in (
        "DetectionRuleOut",
        "DetectionRuleUpdate",
        "DetectionRuleResetResult",
        "HumanReviewConfigOut",
        "HumanReviewConfigUpdate",
    ):
        assert s in schemas, f"missing schema: {s}"
