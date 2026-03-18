# IAM role for the backend service (AgentCore Runtime or App Runner)
resource "aws_iam_role" "backend" {
  name = "${var.project_name}-backend-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = [
            "apprunner.amazonaws.com",
            "ecs-tasks.amazonaws.com",
            "bedrock.amazonaws.com",
          ]
        }
      }
    ]
  })
}

# S3 access for document upload/download
resource "aws_iam_role_policy" "s3_access" {
  name = "${var.project_name}-s3-access"
  role = aws_iam_role.backend.id

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
      }
    ]
  })
}

# Bedrock access for Claude, Nova models
resource "aws_iam_role_policy" "bedrock_access" {
  name = "${var.project_name}-bedrock-access"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.*",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.*",
          "arn:aws:bedrock:us.*::foundation-model/anthropic.*",
          "arn:aws:bedrock:us.*::foundation-model/amazon.*",
        ]
      }
    ]
  })
}

# BDA access
resource "aws_iam_role_policy" "bda_access" {
  name = "${var.project_name}-bda-access"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeDataAutomationAsync",
          "bedrock:GetDataAutomationStatus",
          "bedrock:ListDataAutomationProjects",
          "bedrock:GetDataAutomationProject",
        ]
        Resource = "*"
      }
    ]
  })
}

# Textract access
resource "aws_iam_role_policy" "textract_access" {
  name = "${var.project_name}-textract-access"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "textract:AnalyzeDocument",
          "textract:DetectDocumentText",
          "textract:AnalyzeExpense",
          "textract:AnalyzeID",
        ]
        Resource = "*"
      }
    ]
  })
}

# ECR access for container images
resource "aws_iam_role_policy" "ecr_access" {
  name = "${var.project_name}-ecr-access"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:GetAuthorizationToken",
        ]
        Resource = "*"
      }
    ]
  })
}
