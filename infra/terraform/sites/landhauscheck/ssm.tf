# ── SSM Parameter Store — prod API keys ──────────────────────────────────────
# Uses SecureString (free, standard tier) instead of Secrets Manager
# ($0.40/secret/month). Saves ~$3.60/month vs the previous Secrets Manager setup.
#
# Values are read from SSM at `tofu apply` time and baked into Lambda env vars —
# Lambda itself never calls SSM at runtime (no latency or cost overhead).
# See lambda.tf for the injection pattern.
#
# ⚠️  All values are stored in tfstate (local file). Acceptable for a personal
# project with local state. Do not commit tfstate or terraform.tfvars.

resource "aws_ssm_parameter" "here_api_key" {
  name        = "/${local.name}/here-api-key"
  description = "HERE Maps server-side key (basicwebapp-server) — transit proxy in Lambda; no domain restriction"
  type        = "SecureString"
  value       = var.here_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "here_browser_api_key" {
  name        = "/${local.name}/here-browser-api-key"
  description = "HERE Maps browser key (basicwebapp-browser) — map tile rendering in frontend; domain-restricted to landhauscheck.com"
  type        = "SecureString"
  value       = var.here_browser_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "db_stada_client_id" {
  name        = "/${local.name}/db-stada-client-id"
  description = "DB StaDa API client ID for BasicWebApp (railway station lookup)"
  type        = "SecureString"
  value       = var.db_stada_client_id
  tags        = local.tags
}

resource "aws_ssm_parameter" "db_stada_api_key" {
  name        = "/${local.name}/db-stada-api-key"
  description = "DB StaDa API key for BasicWebApp (railway station lookup)"
  type        = "SecureString"
  value       = var.db_stada_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "google_maps_api_key" {
  name        = "/${local.name}/google-maps-api-key"
  description = "Google Maps server-side key (basicwebapp-server) — Directions, Places, Geocoding; no referrer restriction"
  type        = "SecureString"
  value       = var.google_maps_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "google_maps_browser_api_key" {
  name        = "/${local.name}/google-maps-browser-api-key"
  description = "Google Maps browser key (basicwebapp-browser) — Maps JS + Geocoding, referrer restricted to landhauscheck.com"
  type        = "SecureString"
  value       = var.google_maps_browser_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "tankerkoenig_api_key" {
  name        = "/${local.name}/tankerkoenig-api-key"
  description = "Tankerkönig API key for Germany fuel prices — server-side only, never in browser"
  type        = "SecureString"
  value       = var.tankerkoenig_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "jira_api_key" {
  name        = "/${local.name}/jira-api-key"
  description = "Atlassian Jira Cloud API token for creating feature-request issues (project LHC)"
  type        = "SecureString"
  value       = var.jira_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "github_token" {
  name        = "/${local.name}/github-token"
  description = "GitHub PAT (repo scope) for waste-calendar PR creation"
  type        = "SecureString"
  value       = var.github_token
  tags        = local.tags
}
