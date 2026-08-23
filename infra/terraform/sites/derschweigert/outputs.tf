output "site_bucket" {
  value = module.site.site_bucket
}

output "cloudfront_url" {
  value = module.site.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  value = module.site.cloudfront_distribution_id
}

output "api_gateway_url" {
  value = module.api.stage_invoke_url
}

output "route53_nameservers" {
  value = data.aws_route53_zone.primary.name_servers
}
