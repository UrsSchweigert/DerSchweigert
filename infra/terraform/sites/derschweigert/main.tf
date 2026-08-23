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

  # Reserved for ffm.derschweigert.de until it gets its own dedicated stack
  # under infra/terraform/sites/ffm. Until then it rides on this CloudFront
  # distribution as an extra alias.
  pin_lock_function_code = <<-EOF
  function handler(event) {
    var request = event.request;
    var uri = request.uri || '/';
    var headers = request.headers || {};
    var host = headers.host && headers.host.value ? headers.host.value.toLowerCase() : '';

    var hasPinCookie = false;
    var cookies = request.cookies || {};
    if (cookies.ams_pin && cookies.ams_pin.value === '1') {
      hasPinCookie = true;
    }
    var cookieHeader = headers.cookie && headers.cookie.value ? headers.cookie.value : '';
    if (!hasPinCookie && cookieHeader) {
      var parts = cookieHeader.split(';');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].trim().split('=');
        if (kv[0] === 'ams_pin' && kv[1] === '1') {
          hasPinCookie = true;
          break;
        }
      }
    }

    if (host.indexOf('localhost') !== -1 || host === '127.0.0.1' || host === 'ffm.derschweigert.de' || host === 'www.ffm.derschweigert.de') {
      return request;
    }

    var isPublicPath = uri === '/health' || uri === '/unlock' || uri === '/favicon.ico' || uri.startsWith('/static/') || uri.startsWith('/api/') || uri === '/contact' || uri === '/impressum' || uri === '/datenschutz';

    if (!isPublicPath && !hasPinCookie) {
      return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: {
          location: { value: '/unlock?next=' + encodeURIComponent(uri) },
          'cache-control': { value: 'no-store' }
        }
      };
    }

    return request;
  }
  EOF
}

data "aws_route53_zone" "primary" {
  zone_id = var.route53_zone_id
}

resource "aws_secretsmanager_secret" "github_contact_token" {
  name                    = "${local.app_name}/github-contact-token"
  description             = "GitHub token for creating contact-form issues"
  recovery_window_in_days = 0
  tags                    = local.tags
}

module "api" {
  source = "../../modules/api_backend"

  app_name          = local.app_name
  description       = "Contact and admin API for ${local.domain}"
  lambda_source_dir = "${path.root}/../../../../sites/derschweigert/lambda"

  environment_variables = {
    APP_ENV                   = "production"
    APP_DOMAIN                 = local.domain
    CANONICAL_HOST             = local.www_domain
    SITE_URL                   = "https://${local.www_domain}"
    CONTACT_EMAIL              = "hello@${local.domain}"
    ADMIN_PIN                  = "3009"
    ADMIN_COOKIE_NAME          = "ams_pin"
    GITHUB_CONTACT_REPOSITORY = "UrsSchweigert/DerSchweigert"
    GITHUB_CONTACT_SECRET_ARN = aws_secretsmanager_secret.github_contact_token.arn
  }

  secret_arns          = [aws_secretsmanager_secret.github_contact_token.arn]
  secrets_policy_name  = "${local.app_name}-github-contact"

  tags = local.tags
}

module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  app_name            = local.app_name
  domain              = local.domain
  additional_aliases  = [local.www_domain, local.ffm_domain]
  route53_zone_id                  = data.aws_route53_zone.primary.zone_id
  viewer_request_function_code     = local.pin_lock_function_code
  viewer_request_function_comment  = "Block access until a valid PIN cookie is present"

  api_origin = {
    origin_id   = "api-origin"
    domain_name = "${module.api.rest_api_id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_path = "/prod"
  }

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

moved {
  from = aws_lambda_function.api
  to   = module.api.aws_lambda_function.api
}

moved {
  from = aws_iam_role.lambda_exec
  to   = module.api.aws_iam_role.lambda_exec
}

moved {
  from = aws_iam_role_policy_attachment.lambda_basic
  to   = module.api.aws_iam_role_policy_attachment.lambda_basic
}

moved {
  from = aws_iam_role_policy.lambda_github_contact
  to   = module.api.aws_iam_role_policy.lambda_secrets[0]
}

moved {
  from = aws_api_gateway_rest_api.api
  to   = module.api.aws_api_gateway_rest_api.api
}

moved {
  from = aws_api_gateway_resource.proxy
  to   = module.api.aws_api_gateway_resource.proxy
}

moved {
  from = aws_api_gateway_method.proxy
  to   = module.api.aws_api_gateway_method.proxy
}

moved {
  from = aws_api_gateway_integration.proxy
  to   = module.api.aws_api_gateway_integration.proxy
}

moved {
  from = aws_api_gateway_method.proxy_root
  to   = module.api.aws_api_gateway_method.proxy_root
}

moved {
  from = aws_api_gateway_integration.proxy_root
  to   = module.api.aws_api_gateway_integration.proxy_root
}

moved {
  from = aws_lambda_permission.apigw
  to   = module.api.aws_lambda_permission.apigw
}

moved {
  from = aws_api_gateway_deployment.api
  to   = module.api.aws_api_gateway_deployment.api
}

moved {
  from = aws_api_gateway_stage.prod
  to   = module.api.aws_api_gateway_stage.prod
}
