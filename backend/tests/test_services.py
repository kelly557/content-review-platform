"""Smoke tests for the services router."""
from app.main import app


def test_services_routes_registered():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/v1/services" in paths
    assert "/api/v1/services/{service_id}" in paths


def test_openapi_includes_services_in_strategy():
    schema = app.openapi()
    strategy_post = schema["paths"]["/api/v1/strategies"]["post"]
    ref = strategy_post["requestBody"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/StrategyCreate")
    strategy_create = schema["components"]["schemas"]["StrategyCreate"]
    assert "services" in strategy_create["properties"]