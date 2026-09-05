variable "app_name" {
  description = "Short name used for resource naming"
  type        = string
}

variable "domain" {
  description = "Primary domain served by this distribution (also the ACM certificate CN)"
  type        = string
}

variable "additional_aliases" {
  description = "Extra CloudFront aliases / ACM subject alternative names (e.g. www, other subdomains)"
  type        = list(string)
  default     = []
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID to create alias and validation records in"
  type        = string
}

variable "price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"
}

variable "default_root_object" {
  description = "CloudFront default root object"
  type        = string
  default     = "index.html"
}

variable "viewer_request_function_code" {
  description = "Optional CloudFront Functions (JS) code to run on viewer-request for the default cache behavior"
  type        = string
  default     = null
}

variable "viewer_request_function_comment" {
  description = "Comment for the CloudFront viewer-request function"
  type        = string
  default     = null
}

variable "api_origin" {
  description = "Optional API Gateway origin to add as a second CloudFront origin with /api/* and /unlock* cache behaviors"
  type = object({
    origin_id   = string
    domain_name = string
    origin_path = string
  })
  default = null
}

variable "content_security_policy" {
  description = "Content-Security-Policy header value applied via the response headers policy. Default assumes a same-origin-only site with no external CDNs/fonts, and allows inline `style=\"...\"` attributes (both sites use them for simple show/hide toggling) without allowing inline <script>."
  type        = string
  default     = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}
