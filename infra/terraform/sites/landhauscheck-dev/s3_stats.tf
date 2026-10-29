# ── Stats persistence bucket — dev ───────────────────────────────────────────

resource "aws_s3_bucket" "stats" {
  bucket = "${local.name}-stats-${data.aws_caller_identity.current.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "stats" {
  bucket = aws_s3_bucket.stats.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "stats" {
  bucket = aws_s3_bucket.stats.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_public_access_block" "stats" {
  bucket                  = aws_s3_bucket.stats.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "stats" {
  bucket = aws_s3_bucket.stats.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "stats_bucket_name" {
  value = aws_s3_bucket.stats.bucket
}
