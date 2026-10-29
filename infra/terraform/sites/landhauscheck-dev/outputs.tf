output "aws_region" {
  description = "AWS region"
  value       = var.aws_region
}

output "domain_url" {
  description = "Dev public URL"
  value       = "https://${var.domain_name}"
}

output "frontend_url" {
  description = "Dev frontend URL"
  value       = "https://${var.domain_name}"
}

output "backend_url" {
  description = "Dev backend URL (routed through CloudFront)"
  value       = "https://${var.domain_name}"
}

output "s3_bucket_name" {
  description = "Dev S3 frontend bucket name"
  value       = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "Dev CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}
