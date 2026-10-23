from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings(BaseModel):
    app_name: str = Field(default="DerSchweigert")
    app_env: str = Field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    admin_pin: str = Field(default_factory=lambda: os.getenv("ADMIN_PIN", "3009"))
    admin_cookie_name: str = Field(default_factory=lambda: os.getenv("ADMIN_COOKIE_NAME", "ams_pin"))
    contact_email: str = Field(default_factory=lambda: os.getenv("CONTACT_EMAIL", "hello@derschweigert.de"))
    domain: str = Field(default_factory=lambda: os.getenv("APP_DOMAIN", "derschweigert.de"))
    canonical_host: str = Field(default_factory=lambda: os.getenv("CANONICAL_HOST", "www." + os.getenv("APP_DOMAIN", "derschweigert.de")))
    site_url: str = Field(default_factory=lambda: os.getenv("SITE_URL", "https://" + os.getenv("CANONICAL_HOST", "www." + os.getenv("APP_DOMAIN", "derschweigert.de"))))
    pin_protection_enabled: bool = Field(default_factory=lambda: os.getenv("PIN_PROTECTION_ENABLED", "false").lower() == "true")
    cors_origins: list[str] = Field(default_factory=lambda: [
        o.strip()
        for o in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,https://derschweigert.de,https://www.derschweigert.de",
        ).split(",")
        if o.strip()
    ])


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
