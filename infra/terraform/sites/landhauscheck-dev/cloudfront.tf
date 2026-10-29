# ── Security Response Headers Policy ─────────────────────────────────────────

resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name    = "${local.name}-security-headers"
  comment = "Security headers for ${local.name}"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

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

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    content_security_policy {
      content_security_policy = join(" ", [
        "default-src 'self';",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.google.com https://js.api.here.com https://cdn.jsdelivr.net https://unpkg.com;",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com;",
        "font-src 'self' data: https://fonts.gstatic.com;",
        "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.hereapi.com https://*.here.com https://*.openstreetmap.org;",
        "connect-src 'self' https://*.googleapis.com https://*.hereapi.com https://api.open-meteo.com https://nominatim.openstreetmap.org https://api.bigdatacloud.net https://*.g.doubleclick.net;",
        "worker-src 'self' blob:;",
        "frame-ancestors 'none';",
        "form-action 'self';"
      ])
      override = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(self), payment=()"
      override = true
    }
  }
}

# ── Stats PIN Guard (CloudFront Function) ─────────────────────────────────────
# ⚠️ PIN CHANGE: update var.stats_pin AND this function's literal string, then
# run `tofu apply` + `deploy.sh aws --env dev --frontend-only`.

resource "aws_cloudfront_function" "stats_pin_guard" {
  name    = "${local.name}-stats-pin-guard"
  runtime = "cloudfront-js-2.0"
  comment = "Guard /stats.html on dev.landhauscheck.com"
  publish = true

  code = <<-EOT
    function handler(event) {
      var cookies = event.request.cookies;
      var pin = cookies['lhc_pin'];
      if (!pin || pin.value !== '${var.stats_pin}') {
        return {
          statusCode: 302,
          statusDescription: 'Found',
          headers: { location: { value: '/stats-login.html' } }
        };
      }
      return event.request;
    }
  EOT
}

# ── Origin Access Control ─────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name}-oac"
  description                       = "OAC for ${local.name} S3 frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront Distribution — dev ─────────────────────────────────────────────

resource "aws_cloudfront_distribution" "frontend" {
  # S3 origin — serves the React SPA
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.bucket}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # API Gateway origin — proxies /api/* and /health
  origin {
    domain_name = trimprefix(aws_apigatewayv2_api.backend.api_endpoint, "https://")
    origin_id   = "APIGW-backend"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${local.name} frontend (dev.landhauscheck.com)"

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  # /health — backend health-check
  ordered_cache_behavior {
    path_pattern              = "/health"
    allowed_methods           = ["GET", "HEAD", "OPTIONS"]
    cached_methods            = ["GET", "HEAD"]
    target_origin_id          = "APIGW-backend"
    viewer_protocol_policy    = "https-only"
    compress                  = false
    min_ttl                   = 0
    default_ttl               = 0
    max_ttl                   = 0
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Accept", "Content-Type", "Origin"]
      cookies { forward = "none" }
    }
  }

  # /api/* — all REST API calls
  ordered_cache_behavior {
    path_pattern              = "/api/*"
    allowed_methods           = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods            = ["GET", "HEAD"]
    target_origin_id          = "APIGW-backend"
    viewer_protocol_policy    = "https-only"
    compress                  = false
    min_ttl                   = 0
    default_ttl               = 0
    max_ttl                   = 0
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    forwarded_values {
      query_string = true
      headers = [
        "Authorization", "Accept", "Content-Type", "Origin",
        "CloudFront-Viewer-Country",
        "CloudFront-Viewer-City",
        "CloudFront-Viewer-Latitude",
        "CloudFront-Viewer-Longitude",
        "X-Stats-Pin",
      ]
      # Forward lhc_devmode so the Lambda middleware can skip tracking for the developer.
      cookies {
        forward = "whitelist"
        whitelisted_names = ["lhc_devmode"]
      }
    }
  }

  # /stats.html — PIN-guarded by CloudFront Function
  ordered_cache_behavior {
    path_pattern              = "/stats.html"
    allowed_methods           = ["GET", "HEAD"]
    cached_methods            = ["GET", "HEAD"]
    target_origin_id          = "S3-${aws_s3_bucket.frontend.bucket}"
    viewer_protocol_policy    = "redirect-to-https"
    compress                  = true
    min_ttl                   = 0
    default_ttl               = 0
    max_ttl                   = 0
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.stats_pin_guard.arn
    }

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  # Default behavior — serves the React SPA from S3
  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "S3-${aws_s3_bucket.frontend.bucket}"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600  # 1 hour
    max_ttl     = 86400 # 24 hours
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  aliases = [var.domain_name]

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.dev.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.tags
}
