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

variable "domain_name" {
  description = "Custom domain name (e.g., idp.sanghwa.people.aws.dev). Leave empty to use CloudFront default domain."
  type        = string
  default     = ""
}
