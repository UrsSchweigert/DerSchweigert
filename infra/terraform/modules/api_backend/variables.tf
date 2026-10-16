variable "app_name" {
  description = "Short name used for resource naming"
  type        = string
}

variable "lambda_source_dir" {
  description = "Directory containing the Lambda function source code, to be zipped"
  type        = string
}

variable "handler" {
  description = "Lambda handler entrypoint"
  type        = string
  default     = "handler.lambda_handler"
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "python3.12"
}

variable "timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Lambda memory size in MB"
  type        = number
  default     = 512
}

variable "log_retention_in_days" {
  description = "CloudWatch Logs retention for this Lambda's log group. 30 days by default per the project's approved application-log retention policy; application code must not log sensitive content (secrets, tokens, full emails/PII) regardless of this setting."
  type        = number
  default     = 30
}

variable "environment_variables" {
  description = "Environment variables for the Lambda function"
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Secrets Manager secret ARNs the Lambda execution role may read"
  type        = list(string)
  default     = []
}

variable "secrets_policy_name" {
  description = "Name for the inline IAM policy granting secret access"
  type        = string
  default     = null
}

variable "description" {
  description = "Description for the API Gateway REST API"
  type        = string
  default     = null
}

variable "tags" {
  description = "Common tags applied to all resources"
  type        = map(string)
  default     = {}
}
