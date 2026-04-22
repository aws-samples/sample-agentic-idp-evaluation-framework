output "s3_bucket_name" {
  description = "S3 bucket for document uploads"
  value       = aws_s3_bucket.uploads.id
}

output "s3_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.uploads.arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for backend image"
  value       = aws_ecr_repository.backend.repository_url
}

output "agentcore_execution_role_arn" {
  description = "AgentCore execution role ARN"
  value       = aws_iam_role.agentcore_execution.arn
}

output "agentcore_runtime_arn" {
  description = "AgentCore agent runtime ARN"
  value       = aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn
}

output "agentcore_runtime_id" {
  description = "AgentCore agent runtime ID"
  value       = aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_id
}

output "bedrock_guardrail_id" {
  description = "Bedrock Guardrail ID used by the backend"
  value       = local.effective_guardrail_id
}

output "bedrock_guardrail_version" {
  description = "Bedrock Guardrail version used by the backend"
  value       = local.effective_guardrail_version
}

output "bedrock_guardrail_arn" {
  description = "Bedrock Guardrail ARN used by the backend"
  value       = local.effective_guardrail_arn
}

output "agentcore_endpoint" {
  description = "AgentCore runtime invocation endpoint"
  value       = "https://bedrock-agentcore.${var.aws_region}.amazonaws.com/runtimes/${urlencode(aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn)}/invocations"
}

output "apprunner_service_url" {
  description = "App Runner service URL (backend API)"
  value       = "https://${aws_apprunner_service.backend.service_url}"
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (for cache invalidation)"
  value       = aws_cloudfront_distribution.main.id
}

output "static_assets_bucket" {
  description = "S3 bucket for frontend static assets"
  value       = aws_s3_bucket.static_assets.id
}

output "site_url" {
  description = "Site URL"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.main.domain_name}"
}
