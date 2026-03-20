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

        runtime_environment_variables = {
          AWS_REGION         = var.aws_region
          S3_BUCKET          = aws_s3_bucket.uploads.id
          S3_OUTPUT_PREFIX   = "idp-outputs/"
          BDA_PROFILE_ARN    = var.bda_profile_arn
          BDA_PROJECT_ARN    = var.bda_project_arn
          NODE_ENV           = "production"
          PORT               = "3001"
          CLAUDE_MODEL_ID    = "us.anthropic.claude-sonnet-4-6"
          NOVA_MODEL_ID      = "us.amazon.nova-2-lite-v1:0"
          SITE_URL           = var.domain_name != "" ? "https://${var.domain_name}" : ""
          MIDWAY_DISABLED    = "false"
          AGENTCORE_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn
        }
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

# S3 access
resource "aws_iam_role_policy" "apprunner_s3" {
  name = "S3Access"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
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
    }]
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
      Resource = aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn
    }]
  })
}
