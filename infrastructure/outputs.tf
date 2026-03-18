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

output "backend_role_arn" {
  description = "IAM role ARN for backend service"
  value       = aws_iam_role.backend.arn
}

output "apprunner_service_url" {
  description = "App Runner service URL"
  value       = aws_apprunner_service.backend.service_url
}

output "apprunner_service_arn" {
  description = "App Runner service ARN"
  value       = aws_apprunner_service.backend.arn
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
