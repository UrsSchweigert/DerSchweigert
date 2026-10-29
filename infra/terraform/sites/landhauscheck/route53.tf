# ── Route 53 + ACM — landhauscheck.com ───────────────────────────────────────
#
# The hosted zone was created by Route 53 when the domain was purchased.
# Terraform looks it up by name so we don't hard-code the zone ID.

data "aws_route53_zone" "landhauscheck" {
  name         = "landhauscheck.com"
  private_zone = false
}

# ── ACM Certificate (must be in us-east-1 for CloudFront) ────────────────────

resource "aws_acm_certificate" "landhauscheck" {
  provider                  = aws.us_east_1
  domain_name               = "landhauscheck.com"
  subject_alternative_names = ["www.landhauscheck.com"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

# ── DNS validation records ────────────────────────────────────────────────────
# Route 53 already hosts the domain, so Terraform can write the CNAME records
# that ACM needs in order to issue the certificate automatically.

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.landhauscheck.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "landhauscheck" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.landhauscheck.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ── Apex record: landhauscheck.com → CloudFront ───────────────────────────────
# Route 53 alias records are free and resolve within AWS (no TTL delay).
# CloudFront's hosted zone ID is always Z2FDTNDATAQYW2 (AWS constant).

resource "aws_route53_record" "apex" {
  zone_id = data.aws_route53_zone.landhauscheck.zone_id
  name    = "landhauscheck.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = data.aws_route53_zone.landhauscheck.zone_id
  name    = "landhauscheck.com"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

# ── www record: www.landhauscheck.com → CloudFront ───────────────────────────

resource "aws_route53_record" "www" {
  zone_id = data.aws_route53_zone.landhauscheck.zone_id
  name    = "www.landhauscheck.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_aaaa" {
  zone_id = data.aws_route53_zone.landhauscheck.zone_id
  name    = "www.landhauscheck.com"
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}
