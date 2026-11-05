# ── Lambda Function ───────────────────────────────────────────────────────────
# Zip-packaged Lambda (Python 3.12, ARM64/Graviton2) wrapping FastAPI via Mangum.
# Free tier: 1M requests + 400,000 GB-seconds/month — effectively $0 at this scale.
# Cold start: ~500–900ms on first request; warm executions are fast (<<100ms).
#
# Packaging: this function previously ran a container image from ECR and is now a
# zip, so it deploys the same way as the other sites in this repo (build zip →
# upload to S3 → `aws lambda update-function-code`). The ECR repository in
# ecr.tf is deliberately left standing (it is no longer referenced here) so the
# last image-based build remains available for rollback; delete ecr.tf and its
# `backend_image_tag` variable once the zip deploy is proven.
#
# The deployed code object is owned by the deploy pipeline, not by Terraform:
# `ignore_changes` on s3_key keeps a bare `terraform apply` (for example
# `deploy.sh aws --infra-only`) from reverting the running code to an older
# artifact. The zip must exist at s3_key before the first apply — the deploy
# scripts upload it before calling `terraform apply`.

resource "aws_lambda_function" "backend" {
  function_name = "${local.name}-backend"
  package_type  = "Zip"
  role          = aws_iam_role.lambda_exec.arn

  s3_bucket = aws_s3_bucket.frontend.bucket
  s3_key    = "deployments/${local.name}-lambda.zip"

  runtime = "python3.12"
  handler = "app.lambda_handler.handler"

  architectures = ["arm64"] # Graviton2 — 20% cheaper per GB-second than x86

  memory_size = 512 # 512 MB — generous for FastAPI cold start; tune down to 256 if stable
  timeout     = 29  # API Gateway HTTP API hard limit is 29 s
  # Note: reserved_concurrent_executions not set — account concurrency limit is low;
  # the account-level cap naturally throttles burst invocations.

  environment {
    variables = {
      APP_ENV              = var.environment
      LOG_LEVEL            = "INFO"
      CLOUDWATCH_LOG_GROUP = "/aws/lambda/${local.name}-backend"
      CORS_ORIGINS         = "http://localhost:5173,https://${aws_cloudfront_distribution.frontend.domain_name}"
      STATS_BUCKET         = aws_s3_bucket.stats.bucket
      # API keys — read from SSM Parameter Store at apply time, baked into Lambda env vars.
      # Lambda does not call SSM at runtime (no latency or cost overhead).
      # See ssm.tf for the parameter definitions.
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
      # Stats dashboard PIN — must match cloudfront.tf stats_pin_guard function.
      # Both read var.stats_pin; rotate by changing the secret and redeploying.
      STATS_PIN = var.stats_pin
    }
  }

  # Ensure log group + role are ready before function creation
  depends_on = [
    aws_cloudwatch_log_group.lambda_backend,
    aws_iam_role_policy_attachment.lambda_basic_exec,
  ]

  lifecycle {
    # Deployed code is owned by the deploy pipeline (see the comment above).
    ignore_changes = [s3_key]
  }

  tags = local.tags
}

# ── CloudWatch Log Group ──────────────────────────────────────────────────────
# Pre-create so we can control retention. Lambda auto-creates this group on
# first invocation if it doesn't exist — pre-creating lets us set retention.

resource "aws_cloudwatch_log_group" "lambda_backend" {
  name              = "/aws/lambda/${local.name}-backend"
  retention_in_days = 7
  tags              = local.tags
}

# ── API Gateway invoke permission ─────────────────────────────────────────────
# Grants API Gateway the right to call this Lambda function.

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
    #
    # Deliberately the whole resource: referencing individual attributes does
    # NOT work, because a replacement keeps those attribute values unchanged.
    # The cost is that an in-place update (e.g. rotating an env var) also
    # deletes and recreates this permission within the same apply.
    replace_triggered_by = [aws_lambda_function.backend]
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "lambda_function_name" {
  description = "Lambda function name — used by deploy script to update function code"
  value       = aws_lambda_function.backend.function_name
}
