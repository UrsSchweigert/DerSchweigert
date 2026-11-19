output "cloudfront_distribution_id" {
  value = module.site.cloudfront_distribution_id
}

output "site_bucket" {
  value = module.site.site_bucket
}

output "api_gateway_url" {
  value = module.api.stage_invoke_url
}

output "function_name" {
  value = module.api.function_name
}
