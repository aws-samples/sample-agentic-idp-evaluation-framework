# ECR repository for backend Docker image.
# checkov:skip=CKV_AWS_136: Repository is already encrypted at rest with the
# AWS-managed AES256 key (ECR default). Migrating to a customer-managed KMS
# key requires destructive replacement of the repository and invalidates
# running App Runner / AgentCore deployments. Documented as accepted risk
# in THREAT_MODEL.md (§5).
resource "aws_ecr_repository" "backend" {
  name                 = "${var.project_name}-backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
