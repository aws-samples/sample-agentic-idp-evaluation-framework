# ============================================================================
# AgentCore Runtime - Deploy Strands agent as managed container
# Set var.deploy_mode = "agentcore" to use this instead of App Runner
# ============================================================================

# AgentCore Agent Runtime
resource "aws_bedrockagentcore_agent_runtime" "idp_agent" {

  agent_runtime_name = replace("${var.project_name}_${var.environment}", "-", "_")
  description        = "ONE IDP Strands-based document processing agent"
  role_arn           = aws_iam_role.agentcore_execution.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${aws_ecr_repository.backend.repository_url}:${var.ecr_image_tag}"
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  environment_variables = {
    AWS_REGION      = var.aws_region
    S3_BUCKET       = aws_s3_bucket.uploads.id
    NODE_ENV        = "production"
    PORT            = "3001"
    CLAUDE_MODEL_ID = "us.anthropic.claude-sonnet-4-6"
    NOVA_MODEL_ID   = "us.amazon.nova-2-lite-v1:0"
  }

  depends_on = [
    aws_iam_role_policy.agentcore_bedrock,
    aws_iam_role_policy.agentcore_s3,
    aws_iam_role_policy_attachment.agentcore_managed,
  ]
}

# ============================================================================
# AgentCore Execution Role
# ============================================================================

resource "aws_iam_role" "agentcore_execution" {
  name  = "${var.project_name}-agentcore-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AgentCoreAssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "bedrock-agentcore.amazonaws.com"
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.id
        }
        ArnLike = {
          "aws:SourceArn" = "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.id}:*"
        }
      }
    }]
  })
}

# Managed policy for AgentCore
resource "aws_iam_role_policy_attachment" "agentcore_managed" {
  count      = var.deploy_mode == "agentcore" ? 1 : 0
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = "arn:aws:iam::aws:policy/BedrockAgentCoreFullAccess"
}

# ECR + CloudWatch + X-Ray
resource "aws_iam_role_policy" "agentcore_infra" {
  name  = "AgentCoreInfraPolicy"
  role  = aws_iam_role.agentcore_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRImageAccess"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetAuthorizationToken",
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
          "logs:DescribeLogGroups",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.id}:log-group:/aws/bedrock-agentcore/runtimes/*"
      },
      {
        Sid    = "XRayTracing"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = "*"
      },
      {
        Sid      = "CloudWatchMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "bedrock-agentcore"
          }
        }
      },
    ]
  })
}

# Bedrock model invocation
resource "aws_iam_role_policy" "agentcore_bedrock" {
  name  = "AgentCoreBedrockPolicy"
  role  = aws_iam_role.agentcore_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockModelInvocation"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = "*"
      },
      {
        Sid    = "BDAAccess"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeDataAutomationAsync",
          "bedrock:GetDataAutomationStatus",
          "bedrock:ListDataAutomationProjects",
          "bedrock:GetDataAutomationProject",
        ]
        Resource = "*"
      },
      {
        Sid    = "TextractAccess"
        Effect = "Allow"
        Action = [
          "textract:AnalyzeDocument",
          "textract:DetectDocumentText",
          "textract:AnalyzeExpense",
          "textract:AnalyzeID",
        ]
        Resource = "*"
      },
    ]
  })
}

# S3 access
resource "aws_iam_role_policy" "agentcore_s3" {
  name  = "AgentCoreS3Policy"
  role  = aws_iam_role.agentcore_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3DocumentAccess"
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
    ]
  })
}

# Workload identity tokens
resource "aws_iam_role_policy" "agentcore_tokens" {
  name  = "AgentCoreTokenPolicy"
  role  = aws_iam_role.agentcore_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WorkloadAccessTokens"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
        ]
        Resource = [
          "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.id}:workload-identity-directory/default",
          "arn:aws:bedrock-agentcore:${var.aws_region}:${data.aws_caller_identity.current.id}:workload-identity-directory/default/workload-identity/*",
        ]
      },
    ]
  })
}

# Data source for account ID
data "aws_caller_identity" "current" {}
