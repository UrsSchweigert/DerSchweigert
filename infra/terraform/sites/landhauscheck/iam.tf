# ── Lambda Execution Role ─────────────────────────────────────────────────────
# Lambda uses this role to write CloudWatch Logs, pull from ECR, and access S3.
# ECS roles have been removed — backend now runs on Lambda (see lambda.tf).

resource "aws_iam_role" "lambda_exec" {
  name = "${local.name}-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

# CloudWatch Logs write (required for Lambda to emit logs)
resource "aws_iam_role_policy_attachment" "lambda_basic_exec" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ECR read — Lambda service uses the execution role to pull the container image
resource "aws_iam_role_policy_attachment" "lambda_ecr_read" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# S3 read/write for stats persistence
resource "aws_iam_role_policy" "lambda_stats_s3" {
  name = "${local.name}-lambda-stats-s3"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:HeadObject"]
      Resource = "${aws_s3_bucket.stats.arn}/*"
    }]
  })
}

# CloudWatch Logs read — for /api/v1/logs endpoint that feeds the frontend console overlay
resource "aws_iam_role_policy" "lambda_cloudwatch_read" {
  name = "${local.name}-lambda-cloudwatch-read"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:FilterLogEvents", "logs:DescribeLogStreams", "logs:GetLogEvents"]
      Resource = "${aws_cloudwatch_log_group.lambda_backend.arn}:*"
    }]
  })
}

# SSM Parameter Store read — allows future runtime SSM fetching without IAM changes.
# Currently values are injected at apply time, so no runtime SSM call is made.
resource "aws_iam_role_policy" "lambda_ssm_read" {
  name = "${local.name}-lambda-ssm-read"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ssm:GetParameter"
      Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/${local.name}/*"
    }]
  })
}
