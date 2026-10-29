"""Application configuration models.

This module centralizes environment-driven settings so runtime behavior is
predictable across local, CI, and future cloud deployments.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables."""

    app_name: str = "Landhauscheck API"
    app_env: str = "development"
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    here_api_key: str = ""
    # DB StaDa (OpenStation) API credentials
    db_stada_client_id: str = ""
    db_stada_api_key: str = ""
    # Google Maps API key (used as fallback for station lookup outside DB dataset)
    google_maps_api_key: str = ""
    # Tankerkönig API key (Germany fuel prices) — server-side only, never in browser
    # ⚠️  i18n/keys: set TANKERKOENIG_API_KEY env var; register at creativecommons.tankerkoenig.de
    tankerkoenig_api_key: str = ""
    # Comma-separated list of allowed CORS origins
    cors_origins: str = "http://localhost:5173"
    # AWS settings for CloudWatch log fetching
    aws_region: str = "eu-west-1"
    cloudwatch_log_group: str = "/aws/lambda/basicwebapp-backend"
    # Stats dashboard PIN — must match the CloudFront Function guard and the
    # X-Stats-Pin header sent by stats.html. Change via STATS_PIN env var.
    stats_pin: str = "3009"

    # ── Jira Cloud (feature request integration) ───────────────────────────
    # Used by the /api/v1/feature-request endpoint to create issues in Jira.
    # Set JIRA_API_KEY in Secrets Manager (prod) or SSM Parameter Store (dev).
    # Generate tokens at: https://id.atlassian.com/manage-profile/security/api-tokens
    jira_host: str = "https://schweigert-dev.atlassian.net"
    jira_email: str = "urs.schweigert@outlook.com"
    jira_api_key: str = ""
    jira_project_key: str = "LHC"
    jira_issue_type_id: str = "10013"  # Task — LHC project

    # ── GitHub (waste calendar contribution) ──────────────────────────────
    # A PAT with `repo` scope is required so the backend can create branches
    # and pull requests on behalf of the user.
    # Store in Secrets Manager (prod) or SSM ParameterStore (dev);
    # inject via the GITHUB_TOKEN environment variable.
    # ⚠  The token must NOT be committed or logged.
    github_token: str = ""
    github_repo: str = "UrsSchweigert/DerSchweigert"

    # ── Dev fixture cache ──────────────────────────────────────────────────
    # Controls whether external API calls are intercepted and served from
    # pre-recorded fixture files in sites/landhauscheck/app/data/fixtures/.
    #
    # Modes:
    #   off     — Normal operation; no caching (default, always used in prod)
    #   on      — Serve from fixtures; skip real network calls (strict replay)
    #   record  — Make real network calls AND save the responses as fixtures
    #             (use once to seed; fixtures are then committed to the repo)
    #
    # Per-request bypass: send  X-Dev-Cache-Bypass: 1  header to skip the
    # cache for a single request even when mode=on (useful for quick spot-checks
    # against live APIs without toggling the env var).
    dev_cache_mode: str = "off"   # "off" | "on" | "record"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached settings instance to avoid repeated file parsing."""

    return Settings()
