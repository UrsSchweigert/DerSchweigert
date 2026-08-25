output "rest_api_id" {
  value = aws_api_gateway_rest_api.api.id
}

output "execution_arn" {
  value = aws_api_gateway_rest_api.api.execution_arn
}

output "invoke_arn" {
  value = aws_lambda_function.api.invoke_arn
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "stage_invoke_url" {
  value = aws_api_gateway_stage.prod.invoke_url
}

output "lambda_role_name" {
  value = aws_iam_role.lambda_exec.name
}
