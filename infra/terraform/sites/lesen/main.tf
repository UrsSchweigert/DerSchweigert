provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  app_name = "derschweigert-lesen"
  project  = "lesen"
  domain   = "lesen.derschweigert.de"
  tags = {
    Project   = local.project
    ManagedBy = "terraform"
    Domain    = local.domain
  }
}

module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  app_name        = local.app_name
  domain          = local.domain
  route53_zone_id = var.route53_zone_id

  content_security_policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

  tags = local.tags
}
