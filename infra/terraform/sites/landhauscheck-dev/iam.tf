# ── Lambda Execution Role — dev ───────────────────────────────────────────────

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

resource "aws_iam_role_policy_attachment" "lambda_basic_exec" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

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

# CloudWatch Logs read — for /api/v1/logs endpoint
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

# SSM Parameter Store read — good practice even though values are injected at apply time.
# Allows future switch to runtime SSM fetching without IAM changes.
resource "aws_iam_role_policy" "lambda_ssm_read" {
  name = "${local.name}-lambda-ssm-read"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
      ]
      Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.name}/*"
    }]
  })
}
