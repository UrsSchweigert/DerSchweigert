output "cloudfront_distribution_id" {
  value = module.site.cloudfront_distribution_id
}

output "site_bucket" {
  value = module.site.site_bucket
}

output "api_gateway_url" {
  value = module.api.stage_invoke_url
}

output "lambda_function_arn" {
  value = module.api.invoke_arn
}
