variable "aws_region" {
  description = "AWS region for the deployment"
  type        = string
  default     = "eu-central-1"
}

variable "route53_zone_id" {
  description = "Public Route53 hosted zone ID for the live domain delegation"
  type        = string
  default     = "Z02407051JK3BF2C58UEQ"
}

variable "pin_protection_enabled" {
  description = "Enable the retained homepage PIN gate"
  type        = bool
  default     = false
}

variable "admin_pin" {
  description = "Admin PIN (from the DERSCHWEIGERT_ADMIN_PIN GitHub secret, or TF_VAR_admin_pin locally)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.admin_pin) >= 6
    error_message = "admin_pin must be at least 6 characters."
  }
}
