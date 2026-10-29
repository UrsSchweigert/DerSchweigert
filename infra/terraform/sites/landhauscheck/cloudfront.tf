# ── Security Response Headers Policy ─────────────────────────────────────────
# Applied to all CloudFront behaviors. Addresses OWASP HTTP header findings:
# HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CSP,
# Permissions-Policy.
#
# ⚠️ i18n/CSP REMINDER: If new external domains are used (new APIs, CDNs, fonts)
# update the content_security_policy string below accordingly.

resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name    = "${local.name}-security-headers"
  comment = "Security headers for ${local.name}"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000 # 1 year
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true # sets X-Content-Type-Options: nosniff
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

    # CSP is intentionally permissive for Google Maps JS + HERE Maps JS:
    # - 'unsafe-inline' / 'unsafe-eval' required by Google Maps SDK
    # - worker-src 'self' for the service worker, blob: for HERE Maps
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

# ── Stats PIN Guard (CloudFront Function) ────────────────────────────────────
# Runs at the edge on every /stats.html viewer-request.
# Checks for the lhc_pin cookie; redirects to /stats-login.html if absent or wrong.
# The PIN is also validated server-side in the FastAPI stats endpoint via
# X-Stats-Pin header, providing defence in depth.
#
# ⚠️ PIN CHANGE: update the string "3009" here AND in lambda.tf STATS_PIN env var,
# then run `tofu apply` + `bash scripts/deploy.sh aws --frontend-only`.

resource "aws_cloudfront_function" "stats_pin_guard" {
  name    = "${local.name}-stats-pin-guard"
  runtime = "cloudfront-js-2.0"
  comment = "Guard /stats.html — redirect to /stats-login.html if lhc_pin cookie is missing or wrong"
  publish = true

  code = <<-EOT
    function handler(event) {
      var cookies = event.request.cookies;
      var pin = cookies['lhc_pin'];
      if (!pin || pin.value !== '3009') {
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
# OAC is the modern way to let CloudFront sign requests to S3 (replaces OAI).

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name}-oac"
  description                       = "OAC for ${local.name} S3 frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront Distribution ───────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "frontend" {
  # S3 origin — serves the React SPA static files.
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.bucket}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # API Gateway origin — proxies /api/* and /health to the FastAPI backend.
  # API Gateway serves HTTPS natively; no X-CF-Secret header needed because
  # API Gateway is only reachable via VPC Link (not directly from the internet).
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
  comment             = "${local.name} frontend"

  # React is a single-page app — any path that doesn't match a real file
  # should fall back to index.html so client-side routing works.
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

  # ── Backend API behaviors (ordered, evaluated before the default S3 catch-all) ──

  # /health — backend health-check used by the footer widget.
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

  # /api/* — all REST API calls.
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
      # Include CloudFront viewer geographic headers so the backend can geolocate
      # sessions without external API calls. These are added by CloudFront automatically.
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

  # /stats.html — protected by CloudFront Function PIN guard.
  # Cookie is NOT forwarded to S3 (OAC doesn't need it); the CF Function
  # runs before the origin request and handles the auth redirect.
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

  # ── Default behavior — serves the React SPA from S3 ─────────────────────────
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

    # JS/CSS assets built by Vite get content-hash filenames — safe to cache long-term.
    # index.html should be re-fetched quickly so updates are picked up.
    min_ttl     = 0
    default_ttl = 3600  # 1 hour for index.html
    max_ttl     = 86400 # 24 hours for assets
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  aliases = ["landhauscheck.com", "www.landhauscheck.com"]

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.landhauscheck.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.tags
}
