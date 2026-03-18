# App Runner service for backend deployment
# Alternative to AgentCore Runtime for simpler deployment

resource "aws_apprunner_service" "backend" {
  service_name = "${var.project_name}-backend-${var.environment}"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr.arn
    }

    image_repository {
      image_configuration {
        port = "3001"
        runtime_environment_variables = {
          AWS_REGION     = var.aws_region
          S3_BUCKET      = aws_s3_bucket.uploads.id
          NODE_ENV       = "production"
          PORT           = "3001"
          CLAUDE_MODEL_ID = "us.anthropic.claude-sonnet-4-6"
          NOVA_MODEL_ID   = "us.amazon.nova-2-lite-v1:0"
        }
      }

      image_identifier      = "${aws_ecr_repository.backend.repository_url}:${var.ecr_image_tag}"
      image_repository_type = "ECR"
    }
  }

  instance_configuration {
    cpu               = "1024"
    memory            = "2048"
    instance_role_arn = aws_iam_role.backend.arn
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.project_name}-backend"
  }
}

# App Runner needs a separate role to pull from ECR
resource "aws_iam_role" "apprunner_ecr" {
  name = "${var.project_name}-apprunner-ecr-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "build.apprunner.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_ecr.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}
