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

module "marketing" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  app_name            = "derschweigert-buchstabenzeit"
  domain              = "buchstabenzeit.derschweigert.de"
  route53_zone_id     = var.route53_zone_id
  default_root_object = "index.html"

  content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lesen.derschweigert.de; font-src 'self' https://lesen.derschweigert.de; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

  tags = merge(local.tags, {
    Domain = "buchstabenzeit.derschweigert.de"
  })
}
