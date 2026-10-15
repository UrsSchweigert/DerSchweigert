resource "aws_route53_zone" "arithmoslayer" {
  name = "arithmoslayer.de"
  tags = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

output "arithmoslayer_nameservers" {
  description = "Set these nameservers at GoDaddy only after the new CloudFront aliases are deployed"
  value       = aws_route53_zone.arithmoslayer.name_servers
}
