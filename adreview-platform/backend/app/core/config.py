"""Application configuration via pydantic-settings."""
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "AdReview"
    app_env: str = "dev"
    app_debug: bool = True
    app_secret: str = "change-me"
    app_base_url: str = "http://localhost:8000"

    cors_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    database_url: str = "postgresql+asyncpg://adreview:adreview@localhost:5432/adreview"
    database_url_sync: str = "postgresql+psycopg2://adreview:adreview@localhost:5432/adreview"

    storage_root: Path = Path("./storage")
    storage_max_upload_mb: int = 512
    storage_allowed_mime: List[str] = Field(
        default_factory=lambda: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "video/mp4",
            "video/quicktime",
            "application/pdf",
            "text/plain",
            "text/markdown",
        ],
    )

    maas_base_url: str = "https://maas.marketingforce.com"
    maas_api_key: str = ""
    maas_model: str = "gpt-4o"
    maas_timeout: int = 60
    maas_max_tokens: int = 4096
    maas_temperature: float = 0.1
    maas_response_mode: str = "json_schema"
    maas_enabled: bool = True
    maas_max_text_chars: int = 12000

    @field_validator("cors_origins", "storage_allowed_mime", mode="before")
    @classmethod
    def _parse_list(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("["):
                import json
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    pass
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    jwt_secret: str = "change-me-jwt"
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_min: int = 60 * 24 * 7
    jwt_refresh_ttl_day: int = 30

    log_level: str = "INFO"

    # Analytics — anomaly scanner & notifications
    alert_scanner_enabled: bool = True
    alert_scan_interval_sec: int = 300
    alert_rules_json: str = ""
    alert_webhook_urls: str = ""
    alert_webhook_secrets: str = ""
    alert_notify_emails: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    def ensure_storage_dirs(self) -> None:
        for sub in ("uploads", "thumbnails", "exports"):
            (self.storage_root / sub).mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_storage_dirs()
    return settings


settings = get_settings()
