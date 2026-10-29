# ── API Gateway HTTP API ───────────────────────────────────────────────────────
# Serverless entry-point for /api/* and /health.
# CloudFront connects to the API Gateway invoke URL over HTTPS.
# Cloud Map / VPC Link removed — Lambda replaces ECS, no VPC needed.

resource "aws_apigatewayv2_api" "backend" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  # CORS handled by FastAPI CORSMiddleware — don't double-set here.
  tags = local.tags
}

# ── Lambda integration ────────────────────────────────────────────────────────
# AWS_PROXY passes the raw API Gateway event to the Lambda function.
# payload_format_version 2.0 matches Mangum's default expected format.

resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  payload_format_version = "2.0"
}

# ── Routes ────────────────────────────────────────────────────────────────────
# $default catches every path — CloudFront is the gatekeeper so all real
# traffic arrives as /api/* or /health.

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.backend.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.backend.id}"
}

# ── Auto-deploy stage ─────────────────────────────────────────────────────────

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true

  # Throttling: 50 steady-state req/s, burst up to 100. Protects upstream
  # Lambda concurrency and external API quotas (HERE, Google) from abuse.
  default_route_settings {
    throttling_rate_limit  = 50
    throttling_burst_limit = 100
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.apigw.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "apigw" {
  name              = "/apigateway/${local.name}-backend"
  retention_in_days = 7
  tags              = local.tags
}

# ── Output ────────────────────────────────────────────────────────────────────

output "api_gateway_invoke_url" {
  description = "API Gateway invoke URL — used as CloudFront API backend origin"
  value       = aws_apigatewayv2_stage.default.invoke_url
}
