output "incoming_bucket" {
  description = "S3 bucket storing raw inbound messages before forwarding"
  value       = aws_s3_bucket.incoming.id
}

output "forwarder_function_name" {
  description = "Lambda function name that forwards inbound mail"
  value       = aws_lambda_function.forwarder.function_name
}
