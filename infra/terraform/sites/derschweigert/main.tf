terraform {
  required_version = ">= 1.5.7"

  backend "s3" {
    bucket         = "derschweigert-terraform-state"
    key            = "derschweigert/prod/terraform.tfstate"
    region         = "eu-central-1"
    encrypt        = true
    dynamodb_table = "derschweigert-terraform-locks"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  app_name   = "derschweigert"
  domain     = "derschweigert.de"
  www_domain = "www.${local.domain}"
  ffm_domain = "ffm.${local.domain}"
  tags = {
    Project   = local.app_name
    ManagedBy = "terraform"
    Domain    = local.domain
  }

  # Viewer-request function for the default behavior. The legal pages are
  # uploaded to S3 as HTML files; this rewrites their public, extensionless URLs
  # so the S3 origin resolves the object instead of 403-ing on a missing key.
  # (Until 2026-11-18 it also carried a PIN gate and a /contact 410; both were
  # retired with the contact/admin API.)
  viewer_request_function_code = <<-EOF
  function handler(event) {
    var request = event.request;
    var uri = request.uri || '/';
    if (uri === '/impressum' || uri === '/datenschutz' || uri === '/nutzungsbedingungen') {
      request.uri = uri + '.html';
    }
    return request;
  }
  EOF
}

data "aws_route53_zone" "primary" {
  zone_id = var.route53_zone_id
}

module "email_forwarding" {
  source = "../../modules/email_forwarding"

  domain           = local.domain
  route53_zone_id  = data.aws_route53_zone.primary.zone_id
  recipient_email  = "info@${local.domain}"
  forward_to_email = "urs.schweigert@outlook.com"
  aws_region       = var.aws_region

  tags = local.tags
}

module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  app_name                        = local.app_name
  domain                          = local.domain
  additional_aliases              = [local.www_domain] # ffm gets its own dedicated stack
  route53_zone_id                 = data.aws_route53_zone.primary.zone_id
  viewer_request_function_code    = local.viewer_request_function_code
  viewer_request_function_comment = "Rewrite extensionless legal-page URLs to their .html objects"

  tags = local.tags
}

moved {
  from = aws_s3_bucket.site
  to   = module.site.aws_s3_bucket.site
}

moved {
  from = aws_s3_bucket_public_access_block.site
  to   = module.site.aws_s3_bucket_public_access_block.site
}

moved {
  from = aws_s3_bucket_ownership_controls.site
  to   = module.site.aws_s3_bucket_ownership_controls.site
}

moved {
  from = aws_cloudfront_origin_access_identity.site
  to   = module.site.aws_cloudfront_origin_access_identity.site
}

moved {
  from = aws_cloudfront_function.pin_lock
  to   = module.site.aws_cloudfront_function.viewer_request[0]
}

moved {
  from = aws_s3_bucket_policy.site
  to   = module.site.aws_s3_bucket_policy.site
}

moved {
  from = aws_cloudfront_distribution.site
  to   = module.site.aws_cloudfront_distribution.site
}

moved {
  from = aws_acm_certificate.cert
  to   = module.site.aws_acm_certificate.cert
}

moved {
  from = aws_route53_record.cert_validation
  to   = module.site.aws_route53_record.cert_validation
}

moved {
  from = aws_acm_certificate_validation.cert
  to   = module.site.aws_acm_certificate_validation.cert
}

moved {
  from = aws_route53_record.apex
  to   = module.site.aws_route53_record.aliases["derschweigert.de"]
}

moved {
  from = aws_route53_record.www
  to   = module.site.aws_route53_record.aliases["www.derschweigert.de"]
}

moved {
  from = aws_route53_record.ffm
  to   = module.site.aws_route53_record.aliases["ffm.derschweigert.de"]
}
