"""Smoke tests for the FastAPI app - verify routes register and schema validate."""
from fastapi.testclient import TestClient


def test_app_starts():
    from app.main import app

    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_openapi_lists_routes():
    from app.main import app

    schema = app.openapi()
    paths = schema["paths"]
    for key in (
        "/api/v1/auth/login",
        "/api/v1/auth/me",
        "/api/v1/materials",
        "/api/v1/materials/{material_id}",
        "/api/v1/reviews/tasks",
        "/api/v1/annotations",
        "/api/v1/workflows/templates",
        "/api/v1/reports/overview",
    ):
        assert key in paths, f"missing route: {key}"


def test_login_validation():
    from app.main import app

    client = TestClient(app)
    r = client.post("/api/v1/auth/login", json={"email": "x", "password": "y"})
    assert r.status_code == 422
