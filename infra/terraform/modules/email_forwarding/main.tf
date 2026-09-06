terraform {
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

data "aws_caller_identity" "current" {}

locals {
  bucket_name     = "${replace(var.domain, ".", "-")}-ses-incoming"
  incoming_prefix = "incoming/"
  function_name   = "${replace(var.domain, ".", "-")}-ses-forwarder"
}

# --- SES domain identity + DKIM (needed so the Lambda can re-send forwarded
# mail "from" a verified identity on this domain; also improves forwarded-mail
# deliverability). Mirrors the pattern used for ffm.derschweigert.de in
# infra/terraform/sites/ffm/main.tf. ---

resource "aws_ses_domain_identity" "domain" {
  domain = var.domain
}

resource "aws_route53_record" "ses_verification" {
  zone_id = var.route53_zone_id
  name    = "_amazonses.${var.domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.domain.verification_token]
}

resource "aws_ses_domain_identity_verification" "domain" {
  domain     = aws_ses_domain_identity.domain.domain
  depends_on = [aws_route53_record.ses_verification]
}

resource "aws_ses_domain_dkim" "domain" {
  domain = aws_ses_domain_identity.domain.domain
}

resource "aws_route53_record" "ses_dkim" {
  # aws_ses_domain_dkim always emits exactly 3 tokens.
  count = 3

  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.domain.dkim_tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.domain.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# MX record so inbound mail for the domain actually reaches SES.
resource "aws_route53_record" "mx" {
  zone_id = var.route53_zone_id
  name    = var.domain
  type    = "MX"
  ttl     = 600
  records = ["10 inbound-smtp.${var.aws_region}.amazonaws.com"]
}

# --- S3 storage for incoming raw messages. The SES receipt rule's S3 action
# writes the full raw MIME message here; the Lambda action (metadata only,
# no body) re-reads it from here to build the forwarded message. ---

resource "aws_s3_bucket" "incoming" {
  bucket = local.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "incoming" {
  bucket                  = aws_s3_bucket.incoming.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "incoming" {
  bucket = aws_s3_bucket.incoming.id

  rule {
    id     = "expire-forwarded-mail"
    status = "Enabled"

    filter {
      prefix = local.incoming_prefix
    }

    # Messages are forwarded immediately on receipt; nothing needs to be kept
    # long-term once that succeeds, so this is just a safety net, not the
    # account's actual retention/archival policy.
    expiration {
      days = 14
    }
  }
}

resource "aws_s3_bucket_policy" "incoming" {
  bucket = aws_s3_bucket.incoming.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSESPuts"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.incoming.arn}/*"
      Condition = {
        StringEquals = {
          "aws:Referer" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })
}

# --- Lambda forwarder ---

data "archive_file" "forwarder" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_src"
  output_path = "${path.root}/.terraform-build/${local.function_name}.zip"
}

resource "aws_iam_role" "forwarder" {
  name = "${local.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "forwarder_basic" {
  role       = aws_iam_role.forwarder.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "forwarder" {
  name = "${local.function_name}-access"
  role = aws_iam_role.forwarder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.incoming.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendRawEmail"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "forwarder" {
  function_name    = local.function_name
  role             = aws_iam_role.forwarder.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.forwarder.output_path
  source_code_hash = data.archive_file.forwarder.output_base64sha256
  timeout          = 30
  memory_size      = 256

  environment {
    variables = {
      REGION          = var.aws_region
      INCOMING_BUCKET = aws_s3_bucket.incoming.id
      INCOMING_PREFIX = local.incoming_prefix
      FORWARD_TO      = var.forward_to_email
      MAIL_FROM       = var.recipient_email
    }
  }

  tags = var.tags
}

resource "aws_lambda_permission" "ses_invoke" {
  statement_id   = "AllowSESInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.forwarder.function_name
  principal      = "ses.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

# --- SES receipt rule set. NOTE: only one receipt rule set can be "active"
# per AWS account+region at a time - if this module is ever instantiated more
# than once in the same account/region, the two aws_ses_active_receipt_rule_set
# resources will fight over activation. Fine for the current single-domain use. ---

resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${replace(var.domain, ".", "-")}-inbound"
}

resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

resource "aws_ses_receipt_rule" "forward" {
  name          = "forward-${replace(var.recipient_email, "/[@.]/", "-")}"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = [var.recipient_email]
  enabled       = true
  scan_enabled  = true

  s3_action {
    bucket_name       = aws_s3_bucket.incoming.id
    object_key_prefix = local.incoming_prefix
    position          = 1
  }

  lambda_action {
    function_arn    = aws_lambda_function.forwarder.arn
    invocation_type = "Event"
    position        = 2
  }

  depends_on = [
    aws_s3_bucket_policy.incoming,
    aws_lambda_permission.ses_invoke,
  ]
}
