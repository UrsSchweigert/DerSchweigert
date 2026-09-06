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

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  app_name = "ffm"
  domain   = "ffm.derschweigert.de"
  tags = {
    Project   = "ffm"
    ManagedBy = "terraform"
    Domain    = "ffm.derschweigert.de"
  }
}

data "aws_route53_zone" "primary" {
  zone_id = var.route53_zone_id
}

# SES domain identity + DNS verification/DKIM for transactional email
# (registration verification, password reset, email-change confirmation)
# sent by the Lambda backend. Uses the default (eu-central-1) provider —
# SES does not need the us_east_1 alias used for the ACM cert.
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
  domain = aws_ses_domain_identity.ffm.domain

  depends_on = [aws_route53_record.ses_verification]
}

resource "aws_ses_domain_dkim" "ffm" {
  domain = aws_ses_domain_identity.ffm.domain
}

resource "aws_route53_record" "ses_dkim" {
  # aws_ses_domain_dkim always emits exactly 3 tokens; the token VALUES are
  # only known after apply, but the count is a fixed SES behavior, so `count`
  # (not `for_each`, which needs statically-known keys) is required here.
  count = 3

  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "${aws_ses_domain_dkim.ffm.dkim_tokens[count.index]}._domainkey.${local.domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.ffm.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# JWT signing key. Generated once and stored in Secrets Manager so it is
# reproducible/rotatable via IaC instead of having been set by hand
# directly on the Lambda function outside of Terraform. `ignore_changes`
# on the secret version means a manual rotation in the console/CLI is
# never clobbered by a later `terraform apply`.
resource "random_password" "jwt_secret" {
  length  = 64
  special = true
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "ffm/jwt-secret-key"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# Cloudflare Turnstile secret key was created directly via
# `aws secretsmanager create-secret --name ffm/turnstile-secret-key`
# (see README) rather than by Terraform, since its value originates
# externally at Cloudflare and must never be written into a .tf file or
# Terraform state as plaintext. This is a metadata-only data source
# (never `aws_secretsmanager_secret_version`, which would pull the
# actual secret string into state) — only its ARN is referenced below.
data "aws_secretsmanager_secret" "turnstile_secret" {
  name = "ffm/turnstile-secret-key"
}

module "api" {
  source = "../../modules/api_backend"

  app_name          = "ffm"
  description       = "Math game API for ffm.derschweigert.de"
  lambda_source_dir = "${path.root}/../../../../sites/ffm/lambda"

  environment_variables = {
    APP_ENV                  = "production"
    FLASK_ENV                = "production"
    SECRET_KEY_ARN           = aws_secretsmanager_secret.jwt_secret.arn
    DYNAMODB_RATELIMIT_TABLE = aws_dynamodb_table.ratelimits.name
    RATELIMIT_STORAGE_URI    = "dynamodb://${aws_dynamodb_table.ratelimits.name}"
    SES_SENDER_EMAIL         = "no-reply@ffm.derschweigert.de"
    SES_CONFIGURATION_SET    = aws_ses_configuration_set.ffm_transactional.name
    APP_BASE_URL             = "https://ffm.derschweigert.de"
    TURNSTILE_SECRET_KEY_ARN = data.aws_secretsmanager_secret.turnstile_secret.arn
  }

  secret_arns = [
    aws_secretsmanager_secret.jwt_secret.arn,
    data.aws_secretsmanager_secret.turnstile_secret.arn,
  ]

  tags = local.tags
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "ffm-lambda-dynamodb-access"
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
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.scores.arn,
        aws_dynamodb_table.ratelimits.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ses" {
  name = "ffm-lambda-ses-access"
  role = module.api.lambda_role_name

  # SES authorizes SendEmail against *both* the sending identity and the
  # configuration-set resource named in the request (app/mailer.py always
  # passes ConfigurationSetName). Granting only the identity ARN causes
  # every send to fail with AccessDenied once a configuration set is used.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendEmail",
        "ses:SendRawEmail",
      ]
      Resource = [
        aws_ses_domain_identity.ffm.arn,
        aws_ses_configuration_set.ffm_transactional.arn,
      ]
    }]
  })
}

module "site" {
  source = "../../modules/static_site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  app_name            = local.app_name
  domain              = local.domain
  additional_aliases  = []
  route53_zone_id     = data.aws_route53_zone.primary.zone_id
  default_root_object = "index.html"

  api_origin = {
    origin_id   = "api-origin"
    domain_name = "${module.api.rest_api_id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_path = "/prod"
  }

  # Overrides the module's same-origin-only default: this site embeds
  # Cloudflare Turnstile (see app/captcha.py, static/game/main.js) to guard
  # register/forgot-password/resend-verification. Turnstile's docs
  # (developers.cloudflare.com/turnstile/reference/content-security-policy/)
  # require both script-src and frame-src to allow challenges.cloudflare.com
  # — script-src alone lets api.js load but its iframe still gets blocked.
  # Without this, the browser silently blocks api.js entirely, the widget
  # never renders/produces a token, and the backend (which fails closed on
  # a missing token) rejects every real user's request, not just bots'.
  content_security_policy = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

  tags = local.tags
}

resource "aws_dynamodb_table" "users" {
  name         = "ffm-users"
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
  name         = "ffm-scores"
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
# Counters persist here instead of in Lambda process memory so rate
# limits are enforced consistently across concurrent/cold-started
# execution environments. TTL cleans up expired counter rows.
resource "aws_dynamodb_table" "ratelimits" {
  name         = "ffm-ratelimits"
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

# --- SES sending-activity monitoring ---
#
# A configuration set + CloudWatch event destination is required to get
# per-send/bounce/complaint *counter* metrics into CloudWatch at all — SES
# does not publish these to CloudWatch automatically without one. The
# Lambda's app/mailer.py passes ConfigurationSetName="ffm-transactional"
# on every send so its emails are tracked under this set.
resource "aws_ses_configuration_set" "ffm_transactional" {
  name = "ffm-transactional"
}

resource "aws_ses_event_destination" "ffm_cloudwatch" {
  name                   = "cloudwatch"
  configuration_set_name = aws_ses_configuration_set.ffm_transactional.name
  enabled                = true
  matching_types         = ["send", "bounce", "complaint", "reject"]

  cloudwatch_destination {
    default_value  = aws_ses_configuration_set.ffm_transactional.name
    dimension_name = "ses:configuration-set"
    value_source   = "messageTag"
  }
}

# Notifies a human when SES sending looks abnormal (any bounce/complaint,
# or an unusually high send volume — either could mean abuse is getting
# through the app-level defenses in sites/ffm/app/auth.py, or a bug).
resource "aws_sns_topic" "ffm_alerts" {
  name = "ffm-alerts"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "ffm_alerts_email" {
  topic_arn = aws_sns_topic.ffm_alerts.arn
  protocol  = "email"
  endpoint  = "urs.schweigert@outlook.com"
}

# Any bounce at all is worth a look: this is a small, transactional-only,
# opt-in-registration service, so the legitimate bounce rate should be
# ~0. A real bounce spike threatens the SES production-access
# request/approval and ongoing sending reputation.
resource "aws_cloudwatch_metric_alarm" "ffm_ses_bounce" {
  alarm_name          = "ffm-ses-bounce"
  alarm_description   = "One or more SES bounces for ffm-transactional in a 1-hour window."
  namespace           = "AWS/SES"
  metric_name         = "Bounce"
  dimensions          = { "ses:configuration-set" = "ffm-transactional" }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ffm_alerts.arn]
  tags                = local.tags
}

# Any spam complaint is more urgent than a bounce (a real recipient
# actively flagged the mail) and should be investigated immediately.
resource "aws_cloudwatch_metric_alarm" "ffm_ses_complaint" {
  alarm_name          = "ffm-ses-complaint"
  alarm_description   = "One or more SES spam complaints for ffm-transactional in a 1-hour window."
  namespace           = "AWS/SES"
  metric_name         = "Complaint"
  dimensions          = { "ses:configuration-set" = "ffm-transactional" }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ffm_alerts.arn]
  tags                = local.tags
}

# A generous but finite volume ceiling given expected traffic (a handful
# of registrations/resets per day) — a proxy for either abuse slipping
# past the app-level rate limits at scale, or a runaway bug (e.g. a
# retry loop). 50/hour is well above realistic legitimate traffic but
# well below anything that would risk the account's 200/day sandbox cap
# outright, so it should fire before the account gets throttled by SES
# itself.
resource "aws_cloudwatch_metric_alarm" "ffm_ses_send_volume" {
  alarm_name          = "ffm-ses-send-volume"
  alarm_description   = "SES send volume for ffm-transactional exceeded 50 in a 1-hour window."
  namespace           = "AWS/SES"
  metric_name         = "Send"
  dimensions          = { "ses:configuration-set" = "ffm-transactional" }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ffm_alerts.arn]
  tags                = local.tags
}
