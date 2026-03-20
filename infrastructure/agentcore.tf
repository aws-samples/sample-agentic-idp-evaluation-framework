# ============================================================================
# AgentCore Runtime - Deploy backend as managed container
# Based on: github.com/awslabs/amazon-bedrock-agentcore-samples/terraform/basic-runtime
# ============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_bedrockagentcore_agent_runtime" "idp_agent" {
  agent_runtime_name = replace("${var.project_name}_${var.environment}", "-", "_")
  description        = "IDP Evaluation Framework - document processing agent"
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
    SERVER_MODE        = "agent"
    AWS_REGION         = var.aws_region
    AWS_DEFAULT_REGION = var.aws_region
    S3_BUCKET          = aws_s3_bucket.uploads.id
    S3_OUTPUT_PREFIX    = "idp-outputs/"
    BDA_PROFILE_ARN    = var.bda_profile_arn
    BDA_PROJECT_ARN    = var.bda_project_arn
    NODE_ENV           = "production"
    AGENT_PORT         = "3001"
    CLAUDE_MODEL_ID    = "us.anthropic.claude-sonnet-4-6"
    NOVA_MODEL_ID      = "us.amazon.nova-2-lite-v1:0"
  }

  depends_on = [
    aws_iam_role_policy.agentcore_execution,
    aws_iam_role_policy_attachment.agentcore_managed,
  ]
}

# ============================================================================
# AgentCore Execution Role
# ============================================================================

resource "aws_iam_role" "agentcore_execution" {
  name = "${var.project_name}-agentcore-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AssumeRolePolicy"
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
          "aws:SourceArn" = "arn:aws:bedrock-agentcore:${data.aws_region.current.id}:${data.aws_caller_identity.current.id}:*"
        }
      }
    }]
  })
}

# Managed policy for AgentCore
resource "aws_iam_role_policy_attachment" "agentcore_managed" {
  role       = aws_iam_role.agentcore_execution.name
  policy_arn = "arn:aws:iam::aws:policy/BedrockAgentCoreFullAccess"
}

# Inline execution policy
resource "aws_iam_role_policy" "agentcore_execution" {
  name = "AgentCoreExecutionPolicy"
  role = aws_iam_role.agentcore_execution.id

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
        ]
        Resource = aws_ecr_repository.backend.arn
      },
      {
        Sid      = "ECRTokenAccess"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
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
        Resource = "arn:aws:logs:${data.aws_region.current.id}:${data.aws_caller_identity.current.id}:log-group:/aws/bedrock-agentcore/runtimes/*"
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
      {
        Sid    = "WorkloadAccessTokens"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
        ]
        Resource = [
          "arn:aws:bedrock-agentcore:${data.aws_region.current.id}:${data.aws_caller_identity.current.id}:workload-identity-directory/default",
          "arn:aws:bedrock-agentcore:${data.aws_region.current.id}:${data.aws_caller_identity.current.id}:workload-identity-directory/default/workload-identity/*",
        ]
      },
    ]
  })
}
