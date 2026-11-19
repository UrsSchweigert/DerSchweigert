variable "aws_region" {
  description = "AWS region for resource deployment"
  type        = string
  default     = "eu-central-1"
}

variable "domain_name" {
  description = "Hostname of the dev environment. A record inside the existing derschweigert.de zone, so no hosted zone of its own"
  type        = string
  default     = "ffm-dev.derschweigert.de"
}

variable "route53_zone_id" {
  description = "The EXISTING derschweigert.de hosted zone (the one prod ffm uses). The dev stack only adds records to it"
  type        = string
  default     = "Z02407051JK3BF2C58UEQ"
}
