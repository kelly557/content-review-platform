"""V1 API router aggregator."""
from fastapi import APIRouter

from app.api.v1 import (
    annotations,
    auth,
    detection_rules,
    imagesets,
    material_packages,
    materials,
    reports,
    reviews,
    service_categories,
    services,
    strategies,
    tags,
    users,
    workflows,
    wordsets,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(materials.router)
api_router.include_router(reviews.router)
api_router.include_router(workflows.router)
api_router.include_router(annotations.router)
api_router.include_router(reports.router)
api_router.include_router(strategies.router)
api_router.include_router(service_categories.router)
api_router.include_router(services.router)
api_router.include_router(wordsets.router)
api_router.include_router(imagesets.router)
api_router.include_router(detection_rules.router)
api_router.include_router(detection_rules.hr_router)
api_router.include_router(material_packages.router)
api_router.include_router(tags.router)
