# Dev environment for ffm: https://ffm-dev.derschweigert.de
#
# A second, independent copy of the ffm stack (own bucket, CloudFront, API
# Gateway, Lambda, DynamoDB tables and secrets, all prefixed `ffm-dev`), so a
# change can be tried against real AWS before it is merged to main.
#
# It adds NO hosted zone. The hostname is a record in the existing
# derschweigert.de zone that prod ffm already uses; the static_site module
# writes the ACM validation and alias records there, exactly as it does for prod.
#
# What it deliberately leaves out, compared with ../ffm:
#   - arithmoslayer.de aliases and its hosted zone (prod-only vanity domain)
#   - Stripe and billing: the flags are pinned off below, so dev can never take payment
#   - the SES alarms/SNS topic and the retention cron: nothing here is worth paging on
# What it shares with prod on purpose:
#   - the Turnstile secret (ffm/turnstile-secret-key). The widget's hostname list in
#     the Cloudflare dashboard must include ffm-dev.derschweigert.de (see README.md)
#
# State is separate (ffm/dev/terraform.tfstate), so `terraform apply` here cannot touch prod.

terraform {
  required_version = ">= 1.5.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  app_name = "ffm-dev"
  domain   = var.domain_name
  tags = {
    Project     = "ffm"
    Environment = "dev"
    ManagedBy   = "terraform"
    Domain      = var.domain_name
  }
}

data "aws_route53_zone" "primary" {
  zone_id = var.route53_zone_id
}

# --- Email (SES) ---------------------------------------------------------
# Own identity so dev mail is sent from no-reply@ffm-dev.derschweigert.de with its own DKIM
# domain. That separates the sender domain only: SES bounce and complaint rates are counted for
# the whole account, so a dev build that mails bad addresses can still get sending paused for
# prod. Register with your own address on dev.
resource "aws_ses_domain_identity" "ffm" {
  domain = local.domain
}

resource "aws_route53_record" "ses_verification" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "_amazonses.${local.domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.ffm.verification_token]
}

resource "aws_ses_domain_identity_verification" "ffm" {
  domain     = aws_ses_domain_identity.ffm.domain
  depends_on = [aws_route53_record.ses_verification]
}

resource "aws_ses_domain_dkim" "ffm" {
  domain = aws_ses_domain_identity.ffm.domain
}

resource "aws_route53_record" "ses_dkim" {
  # SES always emits exactly 3 DKIM tokens; their values are only known after
  # apply, so the count must be fixed (for_each needs statically-known keys).
  count = 3

  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "${aws_ses_domain_dkim.ffm.dkim_tokens[count.index]}._domainkey.${local.domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.ffm.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# --- Secrets -------------------------------------------------------------
resource "random_password" "jwt_secret" {
  length  = 64
  special = true
}

# A separate secret and a separate key from prod: a token minted by dev must
# never validate on prod, or the reverse.
resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "ffm-dev/jwt-secret-key"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Metadata-only lookup of prod's existing Turnstile secret (never the value, so
# it never enters this state). See the header comment for why it is shared.
data "aws_secretsmanager_secret" "turnstile_secret" {
  name = "ffm/turnstile-secret-key"
}

# Same job as in prod: lets the app trust X-Viewer-Ip only on requests that
# really came through this distribution (sites/ffm/app/client_ip.py).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

# Guards GET /api/admin/visits. Dev has no use for the real prod token, so it
# gets its own random one, readable from state by whoever can already apply.
resource "random_password" "admin_visits_token" {
  length  = 40
  special = false
}

# --- Data ----------------------------------------------------------------
resource "aws_dynamodb_table" "users" {
  name         = "ffm-dev-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "scores" {
  name         = "ffm-dev-scores"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  tags = local.tags
}

# Backs the flask-limiter dynamodb:// storage (app/ratelimit_storage.py).
resource "aws_dynamodb_table" "ratelimits" {
  name         = "ffm-dev-ratelimits"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = local.tags
}

resource "aws_dynamodb_table" "visits" {
  name         = "ffm-dev-visits"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "date"
  range_key    = "visitor"

  attribute {
    name = "date"
    type = "S"
  }

  attribute {
    name = "visitor"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = local.tags
}

# --- API -----------------------------------------------------------------
module "api" {
  source = "../../modules/api_backend"

  app_name          = local.app_name
  description       = "Math game API for ${local.domain} (dev)"
  lambda_source_dir = "${path.root}/../../../../sites/ffm/lambda"

  environment_variables = {
    # "production" on purpose: dev must run the same config class as prod, and
    # outside production the app also allows http://localhost origins.
    APP_ENV                  = "production"
    FLASK_ENV                = "production"
    SECRET_KEY_ARN           = aws_secretsmanager_secret.jwt_secret.arn
    DYNAMODB_USERS_TABLE     = aws_dynamodb_table.users.name
    DYNAMODB_SCORES_TABLE    = aws_dynamodb_table.scores.name
    DYNAMODB_RATELIMIT_TABLE = aws_dynamodb_table.ratelimits.name
    RATELIMIT_STORAGE_URI    = "dynamodb://${aws_dynamodb_table.ratelimits.name}"
    DYNAMODB_VISITS_TABLE    = aws_dynamodb_table.visits.name
    SES_SENDER_EMAIL         = "no-reply@${local.domain}"
    # Mail about dev sign-ups goes to the operator, never to a real beta list.
    BETA_WAITLIST_NOTIFY_EMAIL = "info@derschweigert.de"
    # Also what CORS allows (sites/ffm/app/__init__.py).
    APP_BASE_URL             = "https://${local.domain}"
    ORIGIN_VERIFY_SECRET     = random_password.origin_verify.result
    TURNSTILE_SECRET_KEY_ARN = data.aws_secretsmanager_secret.turnstile_secret.arn
    ADMIN_VISITS_TOKEN       = random_password.admin_visits_token.result
    # Billing pinned off: dev has no Stripe keys, so it cannot charge anyone.
    ACCESS_CONTROL_ENABLED = "false"
    BILLING_ENABLED        = "false"
    BILLING_SALES_ENABLED  = "false"
    BILLING_TERMS_APPROVED = "false"
  }

  secret_arns = [
    aws_secretsmanager_secret.jwt_secret.arn,
    data.aws_secretsmanager_secret.turnstile_secret.arn,
  ]

  # Dev traffic is a developer and a phone. A low ceiling also caps the bill if
  # the URL is ever scanned.
  throttling_rate_limit  = 10
  throttling_burst_limit = 20

  tags = local.tags
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "ffm-dev-lambda-dynamodb-access"
  role = module.api.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem",
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.scores.arn,
        aws_dynamodb_table.ratelimits.arn,
        aws_dynamodb_table.visits.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ses" {
  name = "ffm-dev-lambda-ses-access"
  role = module.api.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = [aws_ses_domain_identity.ffm.arn]
    }]
  })
}

# --- Site ----------------------------------------------------------------
module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  app_name            = local.app_name
  domain              = local.domain
  route53_zone_id     = data.aws_route53_zone.primary.zone_id
  default_root_object = "index.html"

  # The very same URL rewrites as prod, so dev behaves like prod: / is the promo
  # page, /beta the invite page, /play the game.
  viewer_request_function_code    = file("${path.module}/../ffm/cloudfront/landing-rewrite.js")
  viewer_request_function_comment = "Rewrites / and /promo to the promo landing page, /beta to the beta invite page and /play to the game (dev)"

  api_origin = {
    origin_id   = "api-origin"
    domain_name = "${module.api.rest_api_id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_path = "/prod"
  }

  # Never cache the API on dev, whatever the response headers say, so a change is seen at once.
  api_cache_disabled = true

  api_forward_viewer_ip     = true
  api_origin_verify_enabled = true
  api_origin_verify_secret  = random_password.origin_verify.result

  # Identical to prod: Turnstile needs challenges.cloudflare.com for scripts and
  # frames, and the wide-screen phone frame needs 'self' framing itself.
  # Same Umami Cloud origins as prod (script-src cloud.umami.is, connect-src gateway.umami.is).
  content_security_policy = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://cloud.umami.is; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://gateway.umami.is; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"

  tags = local.tags
}
