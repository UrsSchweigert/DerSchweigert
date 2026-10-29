output "aws_region" {
  description = "AWS region all resources are deployed into"
  value       = var.aws_region
}

output "domain_url" {
  description = "Primary public URL (custom domain via Route 53 + CloudFront)"
  value       = "https://landhauscheck.com"
}

output "frontend_url" {
  description = "Public URL for the React frontend (via CloudFront)"
  value       = "https://landhauscheck.com"
}

output "backend_url" {
  description = "Public HTTPS URL for the FastAPI backend — routed through CloudFront. Use as VITE_API_BASE_URL when building the frontend."
  value       = "https://landhauscheck.com"
}

output "ecr_repository_url" {
  description = "ECR repository URL. No longer used by the Lambda (it deploys as a zip now); kept while the image-based rollback path exists."
  value       = aws_ecr_repository.backend.repository_url
}

output "s3_bucket_name" {
  description = "S3 bucket where frontend static files must be uploaded"
  value       = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — needed to invalidate the cache after a frontend deploy"
  value       = aws_cloudfront_distribution.frontend.id
}

# rds_address removed — RDS has been deprovisioned (cost-reduction branch)
