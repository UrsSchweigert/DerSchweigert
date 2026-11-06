output "cloudfront_distribution_id" {
  value = module.site.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  value = module.site.cloudfront_domain_name
}

output "site_bucket" {
  value = module.site.site_bucket
}

output "marketing_site_bucket" {
  value = module.marketing.site_bucket
}

output "marketing_cloudfront_distribution_id" {
  value = module.marketing.cloudfront_distribution_id
}

output "marketing_cloudfront_domain_name" {
  value = module.marketing.cloudfront_domain_name
}
