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
  default     = "one-idp-tf"
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
  default     = "us.anthropic.claude-opus-5"
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
  # Defaulted to false, which left ACTIVITY_TABLE pointing at a table that was
  # never created: every run-history write failed with ResourceNotFoundException
  # and "Recent Runs" was permanently empty. Creating the table is the correct
  # default; set false only when an existing out-of-band table is in use.
  description = "If true, Terraform creates and manages the DynamoDB activity table. Set to false when an existing out-of-band table is already in use."
  type        = bool
  default     = true
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

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}


# ─── Run-history privacy ──────────────────────────────────────────────────────

variable "disable_run_history" {
  description = <<-EOT
    Disable stored run history (Recent Runs + the "evaluation in progress" resume
    banner).

    MUST be true for any shared or public deployment. With auth_provider = "none"
    every visitor authenticates as the same alias, so a stored run list is a single
    shared list — meaning any visitor can open, resume and read documents that
    someone else uploaded, and one person's evaluation can be contaminated with
    another person's file. That is document disclosure between strangers.

    When true the backend refuses GET /api/runs and GET /api/runs/:id outright (403),
    and the UI hides the nav entry, the route and the resume banner. The refusal is
    server-side on purpose: hiding a nav link is not a security control.

    Defaults to true. An authenticated deployment (Cognito/Midway) can set this to
    false to get real per-user history.
  EOT
  type        = bool
  default     = true
}

# ─── Specialist OCR endpoints (opt-in, self-hosted on SageMaker) ──────────────

variable "sagemaker_ocr_endpoints" {
  description = <<-EOT
    Map of backend env var name -> SageMaker endpoint NAME for the specialist
    document-OCR models. Empty by default: every entry you leave blank makes that
    method report "endpoint not configured" instead of failing at run time.

    These are NOT Bedrock models. Each is a self-hosted SageMaker real-time endpoint
    on a GPU instance that bills hourly WHETHER OR NOT it serves traffic —
    ml.g6e.2xlarge is ~$2.24/hr and ml.g7e.4xlarge ~$7.09/hr, so five idle endpoints
    would add well over $1,000/month. Deploy them deliberately, and delete them when
    you are done demoing.

    Measured over 336 real scanned pages (see the hybrid vision + spatial reasoning
    benchmark): Infinity-Parser2 is the only model that reliably splits dense grid
    layouts; Baidu is cheapest per image and handles ~70% of pages; Surya and Chandra
    have the highest recall but collapse dense grids; dots has the best precision but
    loops on dense pages.

    Recognised keys:
      SAGEMAKER_OCR_INFINITY  - infly/Infinity-Parser2-Pro (35B)
      SAGEMAKER_OCR_BAIDU     - baidu/Unlimited-OCR (3B)
      SAGEMAKER_OCR_SURYA     - Surya OCR 2 (0.65B)
      SAGEMAKER_OCR_CHANDRA   - Chandra OCR 2 (5.3B)
      SAGEMAKER_OCR_DOTS      - dots.ocr (3B)
      SAGEMAKER_OCR_QWEN3VL   - Qwen3-VL (235B)
  EOT
  type        = map(string)
  default     = {}
}

variable "sagemaker_ocr_cost_per_page" {
  description = <<-EOT
    Override the per-image cost used to price the specialist OCR stage, as a string.

    Cost is GPU-hours, not tokens, so the real figure depends on YOUR instance type
    and throughput. Leave empty to use the measured ml.g6e.2xlarge default
    ($2.24/hr / ~263 img/hr = $0.0085/image). For ml.g7e.4xlarge the measured figure
    is $0.0122/image (faster wall-clock, ~31% more per image).
  EOT
  type        = string
  default     = ""
}
