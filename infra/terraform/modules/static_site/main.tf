terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.0"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "aws_s3_bucket" "site" {
  bucket = "${var.app_name}-site-${data.aws_caller_identity.current.account_id}"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_cloudfront_origin_access_identity" "site" {
  comment = "OAI for ${var.domain}"
}

resource "aws_cloudfront_function" "viewer_request" {
  count   = var.viewer_request_function_code == null ? 0 : 1
  name    = "${var.app_name}-pin-lock"
  runtime = "cloudfront-js-2.0"
  comment = coalesce(var.viewer_request_function_comment, "Viewer-request function for ${var.domain}")
  publish = true
  code    = var.viewer_request_function_code
}

# Baseline security response headers, applied to both the static-asset and
# (if present) API cache behaviors below.
resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "${var.app_name}-security-headers"

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000 # 2 years
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontReadOnly"
        Effect = "Allow"
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.site.iam_arn
        }
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.site.arn}/*"
      }
    ]
  })
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = var.default_root_object
  aliases             = concat([var.domain], var.additional_aliases)
  comment             = "Static site for ${var.domain}"
  price_class         = var.price_class

  depends_on = [aws_acm_certificate_validation.cert]

  origin {
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id   = "s3-origin"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.site.cloudfront_access_identity_path
    }
  }

  dynamic "origin" {
    for_each = var.api_origin == null ? [] : [var.api_origin]
    content {
      domain_name = origin.value.domain_name
      origin_id   = origin.value.origin_id
      origin_path = origin.value.origin_path

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "s3-origin"
    compress                   = true
    viewer_protocol_policy     = "redirect-to-https"
    min_ttl                    = 0
    default_ttl                = 3600
    max_ttl                    = 86400
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    dynamic "function_association" {
      for_each = var.viewer_request_function_code == null ? [] : [1]
      content {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.viewer_request[0].arn
      }
    }

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.api_origin == null ? [] : ["/api/*", "/unlock*"]
    content {
      path_pattern     = ordered_cache_behavior.value
      target_origin_id = var.api_origin.origin_id

      allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods             = ["GET", "HEAD"]
      viewer_protocol_policy     = "redirect-to-https"
      compress                   = true
      min_ttl                    = var.api_cache_disabled || ordered_cache_behavior.value == "/unlock*" ? 0 : null
      default_ttl                = var.api_cache_disabled || ordered_cache_behavior.value == "/unlock*" ? 0 : null
      max_ttl                    = var.api_cache_disabled || ordered_cache_behavior.value == "/unlock*" ? 0 : null
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

      forwarded_values {
        query_string = true
        headers      = ["Authorization", "Content-Type", "Origin", "Accept"]

        cookies {
          forward = "all"
        }
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cert.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = var.tags
}

resource "aws_acm_certificate" "cert" {
  provider                  = aws.us_east_1
  domain_name               = var.domain
  subject_alternative_names = var.additional_aliases
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = var.tags
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "cert" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

resource "aws_route53_record" "aliases" {
  for_each = toset(concat([var.domain], var.additional_aliases))

  zone_id = var.route53_zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = true
  }
}
