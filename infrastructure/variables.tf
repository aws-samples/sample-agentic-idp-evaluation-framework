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
  description = "Custom domain name (e.g., idp.sanghwa.people.aws.dev). Leave empty to use CloudFront default domain."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for the domain"
  type        = string
  default     = ""
}

