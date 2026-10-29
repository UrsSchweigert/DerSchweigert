# ── API Gateway HTTP API — dev ────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "backend" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"
  # CORS handled by FastAPI CORSMiddleware
  tags = local.tags
}

resource "aws_apigatewayv2_integration" "backend" {
  api_id                 = aws_apigatewayv2_api.backend.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.backend.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.backend.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.backend.id
  name        = "$default"
  auto_deploy = true

  # Throttling: 100 steady-state req/s, burst up to 200. Higher than prod
  # to allow load testing without interference.
  default_route_settings {
    throttling_rate_limit  = 100
    throttling_burst_limit = 200
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

output "api_gateway_invoke_url" {
  description = "Dev API Gateway invoke URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}
