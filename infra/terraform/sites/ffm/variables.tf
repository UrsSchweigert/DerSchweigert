variable "aws_account_id" {
  description = "AWS account ID for ARN construction"
  type        = string
}

variable "aws_region" {
  description = "AWS region for resource deployment"
  type        = string
  default     = "eu-central-1"
}

variable "domain_name" {
  description = "Primary domain for the FFM Math game"
  type        = string
  default     = "ffm.derschweigert.de"
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for DNS records"
  type        = string
  default     = "Z02407051JK3BF2C58UEQ"
}

variable "api_cache_disabled" {
  description = "When true, disable API caching (set TTL=0); when false, use default response headers"
  type        = bool
  default     = false
}

# Billing configuration — all false by default until launch approval
variable "access_control_enabled" {
  description = "Enable access control checks for premium levels"
  type        = bool
  default     = false
}

variable "grandfather_cutoff" {
  description = "ISO 8601 UTC timestamp; accounts registered before this time get permanent free access"
  type        = string
  default     = ""
  validation {
    condition     = var.grandfather_cutoff == "" || can(regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$", var.grandfather_cutoff))
    error_message = "grandfather_cutoff must be empty or ISO 8601 UTC format (e.g., 2026-10-14T15:00:00Z)."
  }
}

variable "billing_enabled" {
  description = "Enable billing and payment processing"
  type        = bool
  default     = false
}

variable "billing_sales_enabled" {
  description = "Enable sales/checkout flow (requires billing_enabled=true)"
  type        = bool
  default     = false
}

variable "billing_terms_approved" {
  description = "Terms of service and privacy policy reviewed and approved for launch"
  type        = bool
  default     = false
}

variable "stripe_price_id" {
  description = "Stripe price ID for subscription (e.g., price_xxx); empty until billing_enabled=true"
  type        = string
  default     = ""
}

variable "stripe_portal_configuration_id" {
  description = "Stripe customer portal configuration ID; empty until billing_enabled=true"
  type        = string
  default     = ""
}

variable "stripe_secret_key_arn" {
  description = "Optional ARN for Stripe secret API key in Secrets Manager; no value stored in state if provided"
  type        = string
  default     = ""
}

variable "stripe_webhook_secret_arn" {
  description = "Optional ARN for Stripe webhook signing secret in Secrets Manager; no value stored in state if provided"
  type        = string
  default     = ""
}
