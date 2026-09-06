variable "domain" {
  description = "Apex domain to receive inbound mail for (e.g. \"derschweigert.de\")"
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for the domain, to add MX/TXT/CNAME records"
  type        = string
}

variable "recipient_email" {
  description = "Full inbound address to accept mail for (e.g. \"info@derschweigert.de\")"
  type        = string
}

variable "forward_to_email" {
  description = "External mailbox every message received at recipient_email is forwarded to"
  type        = string
}

variable "aws_region" {
  description = "AWS region SES receiving/sending runs in (must be an SES-receiving-capable region)"
  type        = string
  default     = "eu-central-1"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}
