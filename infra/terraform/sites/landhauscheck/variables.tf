# ── Deployment target ────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region to deploy into (e.g. eu-central-1, us-east-1)"
  type        = string
  default     = "eu-central-1"
}

variable "app_name" {
  description = "Application name — used as a prefix for all AWS resources"
  type        = string
  default     = "basicwebapp"
}

variable "environment" {
  description = "Deployment environment tag"
  type        = string
  default     = "prod"
}

# ── Secrets (never commit values — use terraform.tfvars or env vars) ──────────

variable "here_api_key" {
  description = "HERE Maps server-side key (basicwebapp-server) — transit proxy in Lambda; no domain restriction"
  type        = string
  sensitive   = true
}

variable "here_browser_api_key" {
  description = "HERE Maps browser key (basicwebapp-browser) — map tile rendering in frontend; domain-restricted to landhauscheck.com"
  type        = string
  sensitive   = true
}

variable "db_stada_client_id" {
  description = "DB StaDa (OpenStation) API client ID (railway station lookup)"
  type        = string
  sensitive   = true
}

variable "db_stada_api_key" {
  description = "DB StaDa (OpenStation) API key (railway station lookup)"
  type        = string
  sensitive   = true
}

variable "google_maps_api_key" {
  description = "Google Maps server-side key (basicwebapp-server) — Directions, Places, Geocoding; no referrer restriction"
  type        = string
  sensitive   = true
}

variable "google_maps_browser_api_key" {
  description = "Google Maps browser key (basicwebapp-browser) — Maps JS API + Geocoding; referrer restricted to landhauscheck.com"
  type        = string
  sensitive   = true
}

variable "tankerkoenig_api_key" {
  description = "Tankerk\u00f6nig API key for Germany fuel prices — server-side only, never in browser. Register free at creativecommons.tankerkoenig.de"
  type        = string
  sensitive   = true
  default     = "" # empty until key is provided; Lambda returns 503 gracefully
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
variable "db_password" {
  description = "PostgreSQL master password — no longer used (RDS removed). Kept here so existing tfvars files don't break; can be deleted after cleaning up tfvars."
  type        = string
  sensitive   = true
  default     = ""
}

# ── Database ──────────────────────────────────────────────────────────────────

variable "db_username" {
  description = "PostgreSQL master username — no longer used (RDS removed)"
  type        = string
  default     = "app_user"
}

variable "db_name" {
  description = "PostgreSQL database name — no longer used (RDS removed)"
  type        = string
  default     = "basic_webapp"
}

# ── ECS / container ──────────────────────────────────────────────────────────

variable "backend_image_tag" {
  description = "Unused since the Lambda moved from an ECR image to a zip, which the deploy pipeline owns. Retained (with ecr.tf) so the last image-based build stays available for rollback; remove both once the zip deploy is proven."
  type        = string
  default     = "latest"
}

variable "backend_cpu" {
  description = "Fargate task CPU units — 256 = 0.25 vCPU (cheapest)"
  type        = number
  default     = 256
}

variable "backend_memory" {
  description = "Fargate task memory in MB"
  type        = number
  default     = 512
}

variable "backend_desired_count" {
  description = "Number of backend container instances to run"
  type        = number
  default     = 1
}
