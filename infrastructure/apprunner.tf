# ============================================================================
# App Runner - HTTP serving for Express REST API
# CloudFront → App Runner for /api/* routes
# App Runner → AgentCore (IAM auth) for agent invocations
# ============================================================================

resource "aws_apprunner_service" "backend" {
  service_name = "${var.project_name}-backend-${var.environment}"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access.arn
    }

    image_repository {
      image_identifier      = "${aws_ecr_repository.backend.repository_url}:${var.ecr_image_tag}"
      image_repository_type = "ECR"

      image_configuration {
        port = "3001"

        # Only include optional vars when they have non-empty values, to keep
        # the App Runner service env var set identical to the original
        # deployment's minimal set when callers don't opt into the new
        # pluggable-auth features.
        runtime_environment_variables = merge(
          {
            AWS_REGION            = var.aws_region
            S3_BUCKET             = aws_s3_bucket.uploads.id
            S3_OUTPUT_PREFIX      = "idp-outputs/"
            BDA_PROFILE_ARN       = var.bda_profile_arn
            BDA_PROJECT_ARN       = var.bda_project_arn
            NODE_ENV              = "production"
            PORT                  = "3001"
            CLAUDE_MODEL_ID       = var.claude_model_id
            NOVA_MODEL_ID         = var.nova_model_id
            SITE_URL              = var.domain_name != "" ? "https://${var.domain_name}" : ""
            # MIDWAY_DISABLED is kept for back-compat. The backend now reads
            # AUTH_PROVIDER as the source of truth, but if auth_provider=midway
            # we emit MIDWAY_DISABLED=false (original deployment's value).
            MIDWAY_DISABLED       = var.auth_provider == "midway" ? "false" : "true"
            AGENTCORE_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn
            ACTIVITY_TABLE        = "${var.project_name}-activity-${var.environment}"
          },
          var.auth_provider != "midway" ? { AUTH_PROVIDER = var.auth_provider } : {},
          var.admin_users != "" ? { ADMIN_USERS = var.admin_users } : {},
          var.cognito_user_pool_id != "" ? { COGNITO_USER_POOL_ID = var.cognito_user_pool_id } : {},
          var.cognito_client_id != "" ? { COGNITO_CLIENT_ID = var.cognito_client_id } : {},
        )
      }
    }

    auto_deployments_enabled = false
  }

  instance_configuration {
    cpu               = "1024"
    memory            = "2048"
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  tags = {
    Name = "${var.project_name}-backend"
  }
}

# ============================================================================
# App Runner IAM Roles
# ============================================================================

# ECR access role (for pulling images)
resource "aws_iam_role" "apprunner_ecr_access" {
  name = "${var.project_name}-apprunner-ecr-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "build.apprunner.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_ecr_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# Instance role (runtime permissions)
resource "aws_iam_role" "apprunner_instance" {
  name = "${var.project_name}-apprunner-instance-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "tasks.apprunner.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

# S3 access + KMS for encrypted objects
resource "aws_iam_role_policy" "apprunner_s3" {
  name = "S3Access"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.uploads.arn,
          "${aws_s3_bucket.uploads.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
        ]
        Resource = "*"
      },
    ]
  })
}

# Bedrock model invocation
resource "aws_iam_role_policy" "apprunner_bedrock" {
  name = "BedrockAccess"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeDataAutomationAsync",
          "bedrock:GetDataAutomationStatus",
          "bedrock:ListDataAutomationProjects",
          "bedrock:GetDataAutomationProject",
        ]
        Resource = "*"
      },
    ]
  })
}

# Textract access
resource "aws_iam_role_policy" "apprunner_textract" {
  name = "TextractAccess"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "textract:AnalyzeDocument",
        "textract:DetectDocumentText",
        "textract:AnalyzeExpense",
        "textract:AnalyzeID",
        "textract:StartDocumentAnalysis",
        "textract:GetDocumentAnalysis",
        "textract:StartDocumentTextDetection",
        "textract:GetDocumentTextDetection",
      ]
      Resource = "*"
    }]
  })
}

# AgentCore invocation (IAM auth)
resource "aws_iam_role_policy" "apprunner_agentcore" {
  name = "AgentCoreInvoke"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock-agentcore:InvokeAgentRuntime",
        "bedrock-agentcore:InvokeAgentRuntimeStreaming",
      ]
      Resource = [
        aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn,
        "${aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn}/*",
      ]
    }]
  })
}
