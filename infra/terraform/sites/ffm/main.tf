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
    APP_BASE_URL             = "https://ffm.derschweigert.de"
  }

  secret_arns = [aws_secretsmanager_secret.jwt_secret.arn]

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

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendEmail",
        "ses:SendRawEmail",
      ]
      Resource = aws_ses_domain_identity.ffm.arn
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
