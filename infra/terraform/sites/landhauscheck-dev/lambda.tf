# ── Lambda Function — dev ─────────────────────────────────────────────────────
# Reads API key values from SSM parameters at apply time and injects them
# as env vars — Lambda itself never calls SSM at runtime.
#
# Zip-packaged like prod (see the packaging note in
# infra/terraform/sites/landhauscheck/lambda.tf): deployed code is owned by the
# deploy pipeline, so `ignore_changes` on s3_key keeps a bare apply from
# reverting the running code. The zip must exist at s3_key before the first
# apply — the deploy scripts upload it first.

resource "aws_lambda_function" "backend" {
  function_name = "${local.name}-backend"
  package_type  = "Zip"
  role          = aws_iam_role.lambda_exec.arn

  s3_bucket = aws_s3_bucket.frontend.bucket
  s3_key    = "deployments/${local.name}-lambda.zip"

  runtime = "python3.12"
  handler = "app.lambda_handler.handler"

  architectures = ["arm64"] # Graviton2 — 20% cheaper per GB-second than x86

  memory_size = 512
  timeout     = 29 # API Gateway HTTP API hard limit

  environment {
    variables = {
      APP_ENV              = "dev"
      LOG_LEVEL            = "DEBUG"
      CLOUDWATCH_LOG_GROUP = "/aws/lambda/${local.name}-backend"
      CORS_ORIGINS         = "http://localhost:5173,https://${var.domain_name}"
      STATS_BUCKET         = aws_s3_bucket.stats.bucket
      STATS_PIN            = var.stats_pin
      # API keys — read from SSM at apply time, baked into Lambda env vars
      HERE_API_KEY         = aws_ssm_parameter.here_api_key.value
      DB_STADA_CLIENT_ID   = aws_ssm_parameter.db_stada_client_id.value
      DB_STADA_API_KEY     = aws_ssm_parameter.db_stada_api_key.value
      GOOGLE_MAPS_API_KEY  = aws_ssm_parameter.google_maps_api_key.value
      TANKERKOENIG_API_KEY = aws_ssm_parameter.tankerkoenig_api_key.value
      # Jira Cloud — feature-request integration
      JIRA_API_KEY     = aws_ssm_parameter.jira_api_key.value
      JIRA_EMAIL       = "urs.schweigert@outlook.com"
      JIRA_HOST        = "https://schweigert-dev.atlassian.net"
      JIRA_PROJECT_KEY = "LHC"
      # GitHub PAT — waste calendar contribution (creates PRs on user upload)
      GITHUB_TOKEN = aws_ssm_parameter.github_token.value
      GITHUB_REPO  = "UrsSchweigert/DerSchweigert"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda_backend,
    aws_iam_role_policy_attachment.lambda_basic_exec,
  ]

  lifecycle {
    # Deployed code is owned by the deploy pipeline (see the note above).
    ignore_changes = [s3_key]
  }

  tags = local.tags
}

# ── CloudWatch Log Group ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda_backend" {
  name              = "/aws/lambda/${local.name}-backend"
  retention_in_days = 7
  tags              = local.tags
}

# ── API Gateway invoke permission ─────────────────────────────────────────────

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.backend.execution_arn}/*"

  lifecycle {
    # The function's resource-based policy lives on the function itself, so
    # replacing the function silently removes this permission while this
    # resource still looks unchanged (same function name and ARN). Without
    # this, every replacement left API Gateway unable to invoke the function:
    # CloudFront returned 500 with no Lambda invocation and no error log.
    replace_triggered_by = [aws_lambda_function.backend]
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "lambda_function_name" {
  description = "Dev Lambda function name — used by deploy script to update function code"
  value       = aws_lambda_function.backend.function_name
}
