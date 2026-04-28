variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "one-idp"
}

variable "ecr_image_tag" {
  description = "Docker image tag for AgentCore deployment"
  type        = string
  default     = "latest"
}

variable "bda_profile_arn" {
  description = "BDA Standard profile ARN for document automation"
  type        = string
  default     = ""
}

variable "bda_project_arn" {
  description = "BDA Custom project ARN (leave empty to skip BDA Custom)"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Custom domain name (e.g., idp.example.com). Leave empty to use CloudFront default domain."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for the domain (required if domain_name is set)"
  type        = string
  default     = ""
}

variable "cors_allowed_origins" {
  description = "Additional CORS origins for the S3 uploads bucket. http://localhost:5173 and (when set) https://<domain_name> are appended automatically."
  type        = list(string)
  default     = []
}

variable "claude_model_id" {
  description = "Bedrock inference profile / model ID for Claude (passed into backend + agent)"
  type        = string
  default     = "us.anthropic.claude-sonnet-4-6"
}

variable "nova_model_id" {
  description = "Bedrock model ID for Nova (passed into backend + agent)"
  type        = string
  default     = "us.amazon.nova-2-lite-v1:0"
}

variable "auth_provider" {
  description = "Authentication provider: none | cognito | midway. Default is 'none' for demo use; switch to 'cognito' for production or 'midway' for AWS internal deployments."
  type        = string
  default     = "none"

  validation {
    condition     = contains(["none", "cognito", "midway"], var.auth_provider)
    error_message = "auth_provider must be one of: none, cognito, midway."
  }
}

variable "cognito_user_pool_id" {
  description = "Cognito user pool ID (required when auth_provider = cognito)"
  type        = string
  default     = ""
}

variable "cognito_client_id" {
  description = "Cognito app client ID (required when auth_provider = cognito)"
  type        = string
  default     = ""
}

variable "admin_users" {
  description = "Comma-separated list of admin usernames"
  type        = string
  default     = ""
}

variable "manage_activity_table" {
  description = "If true, Terraform creates and manages the DynamoDB activity table. Set to false when an existing out-of-band table is already in use."
  type        = bool
  default     = false
}

variable "manage_guardrail" {
  description = "If true, Terraform creates a Bedrock Guardrail and wires it into the backend. Set to false when supplying an existing guardrail via bedrock_guardrail_id."
  type        = bool
  default     = true
}

variable "bedrock_guardrail_id" {
  description = "Existing Bedrock Guardrail identifier (optional). When set, manage_guardrail should be false."
  type        = string
  default     = ""
}

variable "bedrock_guardrail_version" {
  description = "Existing Bedrock Guardrail version (DRAFT or numeric). Only used when bedrock_guardrail_id is set."
  type        = string
  default     = "DRAFT"
}

variable "terraform_state_bucket" {
  description = "S3 bucket used for the terraform state backend. Set via -backend-config on init."
  type        = string
  default     = ""
}

