"""V1 API router aggregator."""
from fastapi import APIRouter

from app.api.v1 import (
    admin_import_rules,
    alerts,
    annotations,
    audit_items,
    audit_points,
    auth,
    detection_rules,
    dispositions,
    health,
    libraries,
    material_packages,
    materials,
    query,
    reports,
    reviews,
    rule_sets,
    service_categories,
    services,
    strategies,
    tags,
    triggers,
    users,
    webhooks,
    workflows,
)
api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(materials.router)
api_router.include_router(reviews.router)
api_router.include_router(workflows.router)
api_router.include_router(annotations.router)
api_router.include_router(reports.router)
api_router.include_router(alerts.router)
api_router.include_router(strategies.router)
api_router.include_router(service_categories.router)
api_router.include_router(services.router)
api_router.include_router(libraries.router)
api_router.include_router(detection_rules.router)
api_router.include_router(detection_rules.hr_router)
api_router.include_router(audit_items.router)
api_router.include_router(audit_points.router)
api_router.include_router(material_packages.router)
api_router.include_router(tags.router)
api_router.include_router(query.router)
api_router.include_router(triggers.router)
api_router.include_router(webhooks.router)
api_router.include_router(health.router)
api_router.include_router(rule_sets.router)
api_router.include_router(dispositions.router)
api_router.include_router(admin_import_rules.router)
