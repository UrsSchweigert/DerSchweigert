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
