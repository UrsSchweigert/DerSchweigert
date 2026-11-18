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

variable "route53_zone_ids_by_domain" {
  description = "Optional per-hostname hosted zone IDs for aliases outside the primary DNS zone"
  type        = map(string)
  default     = {}
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

variable "api_forward_viewer_ip" {
  description = "When true, a viewer-request CloudFront Function on the /api/* and /unlock* behaviors writes the viewer's address (event.viewer.ip) into X-Viewer-Ip, replacing any client-sent value, and forwards it to the API origin. The API must trust it only together with the X-Origin-Verify secret (api_origin_verify_secret)."
  type        = bool
  default     = false
}

variable "api_origin_verify_enabled" {
  description = "Whether the API origin gets the X-Origin-Verify custom header. A separate, non-sensitive flag because a sensitive value cannot decide a dynamic block's for_each."
  type        = bool
  default     = false
}

variable "api_origin_verify_secret" {
  description = "Value CloudFront sends as X-Origin-Verify to the API origin when api_origin_verify_enabled is true. It proves to the API that a request came through this distribution, so the API can trust X-Viewer-Ip on it."
  type        = string
  default     = null
  sensitive   = true
}

variable "content_security_policy" {
  description = "Content-Security-Policy header value applied via the response headers policy. Default assumes a same-origin-only site with no external CDNs/fonts, and allows inline `style=\"...\"` attributes (both sites use them for simple show/hide toggling) without allowing inline <script>."
  type        = string
  default     = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

variable "api_cache_disabled" {
  description = "When true, set /api/* and /unlock* cache TTLs to 0 (no caching); when false, TTLs are null (use default or response headers)"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}
