# ── Deployment target ────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region (must match production region)"
  type        = string
  default     = "eu-west-1"
}

variable "app_name" {
  description = "Application name prefix for all dev resources"
  type        = string
  default     = "basicwebapp-dev"
}

variable "environment" {
  description = "Deployment environment tag"
  type        = string
  default     = "dev"
}

variable "domain_name" {
  description = "Custom domain for the dev CloudFront distribution"
  type        = string
  default     = "dev.landhauscheck.com"
}

variable "stats_pin" {
  description = "PIN for /stats.html. Must match CloudFront Function and Lambda STATS_PIN env var."
  type        = string
  sensitive   = true
  default     = "3009"
}

# ── API keys (use production values) ─────────────────────────────────────────
# Stored as SSM SecureString parameters (free) instead of Secrets Manager.

variable "here_api_key" {
  description = "HERE Maps server-side key — transit proxy in Lambda"
  type        = string
  sensitive   = true
}

variable "here_browser_api_key" {
  description = "HERE Maps browser key — map tile rendering in frontend"
  type        = string
  sensitive   = true
}

variable "db_stada_client_id" {
  description = "DB StaDa API client ID (railway station lookup)"
  type        = string
  sensitive   = true
}

variable "db_stada_api_key" {
  description = "DB StaDa API key (railway station lookup)"
  type        = string
  sensitive   = true
}

variable "google_maps_api_key" {
  description = "Google Maps server-side key — Directions, Places, Geocoding"
  type        = string
  sensitive   = true
}

variable "google_maps_browser_api_key" {
  description = "Google Maps browser key — Maps JS API (baked into frontend at build time)"
  type        = string
  sensitive   = true
}

variable "tankerkoenig_api_key" {
  description = "Tankerkönig API key — Germany fuel prices (server-side only)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "jira_api_key" {
  description = "Atlassian Jira Cloud API token — used by the /api/v1/feature-request endpoint to create issues in project LHC. Generate at https://id.atlassian.com/manage-profile/security/api-tokens"
  type        = string
  sensitive   = true
  default     = "" # empty until configured; endpoint returns 503 gracefully
}
variable "github_token" {
  description = "GitHub PAT (classic, repo scope) — used by the /api/v1/waste/contribute endpoint to create branches and pull requests for user-uploaded ICS files. Generate at https://github.com/settings/tokens"
  type        = string
  sensitive   = true
  default     = "" # empty until configured; endpoint returns 503 gracefully
}
