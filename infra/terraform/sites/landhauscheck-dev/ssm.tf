# ── SSM Parameter Store — dev API keys ───────────────────────────────────────
# Uses SecureString (free, standard tier) instead of Secrets Manager (~$0.40/secret/month).
# All parameters live under the /basicwebapp-dev/ path prefix.
# Values are injected into Lambda env vars at `tofu apply` time — Lambda itself
# does not call SSM at runtime (same pattern as prod Secrets Manager injection).

resource "aws_ssm_parameter" "here_api_key" {
  name        = "/${local.name}/here-api-key"
  description = "HERE Maps server-side key — transit proxy in dev Lambda"
  type        = "SecureString"
  value       = var.here_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "here_browser_api_key" {
  name        = "/${local.name}/here-browser-api-key"
  description = "HERE Maps browser key — dev frontend tile rendering"
  type        = "SecureString"
  value       = var.here_browser_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "db_stada_client_id" {
  name        = "/${local.name}/db-stada-client-id"
  description = "DB StaDa API client ID — railway station lookup"
  type        = "SecureString"
  value       = var.db_stada_client_id
  tags        = local.tags
}

resource "aws_ssm_parameter" "db_stada_api_key" {
  name        = "/${local.name}/db-stada-api-key"
  description = "DB StaDa API key — railway station lookup"
  type        = "SecureString"
  value       = var.db_stada_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "google_maps_api_key" {
  name        = "/${local.name}/google-maps-api-key"
  description = "Google Maps server-side key — Directions, Places, Geocoding"
  type        = "SecureString"
  value       = var.google_maps_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "google_maps_browser_api_key" {
  name        = "/${local.name}/google-maps-browser-api-key"
  description = "Google Maps browser key — baked into dev frontend build"
  type        = "SecureString"
  value       = var.google_maps_browser_api_key
  tags        = local.tags
}

resource "aws_ssm_parameter" "tankerkoenig_api_key" {
  name        = "/${local.name}/tankerkoenig-api-key"
  description = "Tankerkönig fuel prices key — server-side only"
  type        = "SecureString"
  value       = var.tankerkoenig_api_key != "" ? var.tankerkoenig_api_key : "not-set"
  tags        = local.tags
}

resource "aws_ssm_parameter" "jira_api_key" {
  name        = "/${local.name}/jira-api-key"
  description = "Atlassian Jira Cloud API token — feature-request integration (project LHC)"
  type        = "SecureString"
  value       = var.jira_api_key != "" ? var.jira_api_key : "not-set"
  tags        = local.tags
}

resource "aws_ssm_parameter" "github_token" {
  name        = "/${local.name}/github-token"
  description = "GitHub PAT (repo scope) for waste-calendar PR creation"
  type        = "SecureString"
  value       = var.github_token != "" ? var.github_token : "not-set"
  tags        = local.tags
}
