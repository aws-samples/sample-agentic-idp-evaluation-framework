# ============================================================================
# ECS Fargate — HTTP serving for Express REST API
# CloudFront → ALB → ECS Fargate for /api/* routes
# ECS → AgentCore (IAM auth) for agent invocations
# Replaces the former App Runner service.
# ============================================================================

# ============================================================================
# CloudWatch Log Group
# ============================================================================

resource "aws_cloudwatch_log_group" "ecs_backend" {
  name              = "/ecs/${var.project_name}-backend-${var.environment}"
  retention_in_days = 30

  tags = {
    Name = "${var.project_name}-backend-logs"
  }
}

# ============================================================================
# ECS Cluster
# ============================================================================

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.project_name}-cluster"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# ============================================================================
# ECS Task Definition
# ============================================================================

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.project_name}-backend-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "${aws_ecr_repository.backend.repository_url}:${var.ecr_image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
          protocol      = "tcp"
        }
      ]

      environment = concat(
        [
          { name = "AWS_REGION", value = var.aws_region },
          { name = "S3_BUCKET", value = aws_s3_bucket.uploads.id },
          { name = "S3_OUTPUT_PREFIX", value = "idp-outputs/" },
          { name = "BDA_PROFILE_ARN", value = var.bda_profile_arn },
          { name = "BDA_PROJECT_ARN", value = var.bda_project_arn },
          { name = "NODE_ENV", value = "production" },
          { name = "PORT", value = "3001" },
          { name = "CLAUDE_MODEL_ID", value = var.claude_model_id },
          { name = "NOVA_MODEL_ID", value = var.nova_model_id },
          { name = "SITE_URL", value = var.domain_name != "" ? "https://${var.domain_name}" : "" },
          { name = "AUTH_PROVIDER", value = var.auth_provider },
          { name = "MIDWAY_DISABLED", value = var.auth_provider == "midway" ? "false" : "true" },
          { name = "AGENTCORE_RUNTIME_ARN", value = aws_bedrockagentcore_agent_runtime.idp_agent.agent_runtime_arn },
          { name = "ACTIVITY_TABLE", value = "${var.project_name}-activity-${var.environment}" },
          { name = "CLOUDFRONT_SECRET", value = random_password.cloudfront_secret.result },
        ],
        var.admin_users != "" ? [{ name = "ADMIN_USERS", value = var.admin_users }] : [],
        var.cognito_user_pool_id != "" ? [{ name = "COGNITO_USER_POOL_ID", value = var.cognito_user_pool_id }] : [],
        var.cognito_client_id != "" ? [{ name = "COGNITO_CLIENT_ID", value = var.cognito_client_id }] : [],
        local.effective_guardrail_id != "" ? [
          { name = "BEDROCK_GUARDRAIL_ID", value = local.effective_guardrail_id },
          { name = "BEDROCK_GUARDRAIL_VERSION", value = local.effective_guardrail_version },
        ] : [],
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_backend.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:3001/api/health || exit 1"]
        interval    = 15
        timeout     = 5
        retries     = 5
        startPeriod = 30
      }
    }
  ])

  tags = {
    Name = "${var.project_name}-backend-task"
  }
}

# ============================================================================
# ECS Service
# ============================================================================

resource "aws_ecs_service" "backend" {
  name            = "${var.project_name}-backend-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = 3001
  }

  # Allow ECS to manage desired count externally (e.g. auto-scaling)
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${var.project_name}-backend-service"
  }
}

# ============================================================================
# ECS Security Group — allow inbound from ALB only
# ============================================================================

resource "aws_security_group" "ecs_tasks" {
  name        = "${var.project_name}-ecs-tasks-${var.environment}"
  description = "Allow inbound from ALB on port 3001"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "ALB to ECS"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-ecs-tasks-sg"
  }
}

# ============================================================================
# ECS IAM — Task Execution Role (ECR pull + CloudWatch logs)
# ============================================================================

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-ecs-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ============================================================================
# ECS IAM — Task Role (runtime permissions, migrated from App Runner instance role)
# All policies below are identical to the former apprunner_instance role.
# ============================================================================

resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-ecs-task-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

# S3 access + KMS for encrypted objects
resource "aws_iam_role_policy" "ecs_s3" {
  name = "S3Access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 access is scoped to the uploads bucket + its objects only.
      # nosemgrep: terraform.lang.security.iam.no-iam-data-exfiltration
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
resource "aws_iam_role_policy" "ecs_bedrock" {
  name = "BedrockAccess"
  role = aws_iam_role.ecs_task.id

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
      # ApplyGuardrail is scoped to the guardrail ARN when we manage it,
      # otherwise to * (no resource-level ARN to pin).
      {
        Effect   = "Allow"
        Action   = ["bedrock:ApplyGuardrail"]
        Resource = local.effective_guardrail_arn != "" ? local.effective_guardrail_arn : "*"
      },
    ]
  })
}

# Textract access
resource "aws_iam_role_policy" "ecs_textract" {
  name = "TextractAccess"
  role = aws_iam_role.ecs_task.id

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
resource "aws_iam_role_policy" "ecs_agentcore" {
  name = "AgentCoreInvoke"
  role = aws_iam_role.ecs_task.id

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
