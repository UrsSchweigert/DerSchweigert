# ── Route 53 + ACM — dev.landhauscheck.com ───────────────────────────────────
# Reuses the existing hosted zone (landhauscheck.com).
# Creates a new ACM certificate for the dev subdomain in us-east-1.

data "aws_route53_zone" "landhauscheck" {
  name         = "landhauscheck.com"
  private_zone = false
}

# ── ACM Certificate (must be in us-east-1 for CloudFront) ────────────────────

resource "aws_acm_certificate" "dev" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name # dev.landhauscheck.com
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

# ── DNS validation records ────────────────────────────────────────────────────

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.dev.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }

  zone_id         = data.aws_route53_zone.landhauscheck.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "dev" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.dev.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ── dev.landhauscheck.com → CloudFront (A + AAAA alias) ─────────────────────

resource "aws_route53_record" "dev" {
  zone_id = data.aws_route53_zone.landhauscheck.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront hosted zone ID (AWS constant)
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "dev_aaaa" {
  zone_id = data.aws_route53_zone.landhauscheck.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}
