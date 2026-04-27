# ============================================================================
# DynamoDB — activity / usage tracking
# ----------------------------------------------------------------------------
# The table was originally created out-of-band. If you already have a live
# table and don't want Terraform to manage it, set `manage_activity_table=false`
# and keep using it. For fresh deployments, leave the default and Terraform
# will create it.
# ----------------------------------------------------------------------------
# Schema: PK=userId (S), SK=timestamp#type (S). PAY_PER_REQUEST so there's no
# capacity to tune.
# ============================================================================

# Customer-managed KMS key for the activity table (Semgrep aws-dynamodb-table-unencrypted).
resource "aws_kms_key" "dynamodb" {
  count                   = var.manage_activity_table ? 1 : 0
  description             = "${var.project_name} DynamoDB activity table encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "dynamodb" {
  count         = var.manage_activity_table ? 1 : 0
  name          = "alias/${var.project_name}-ddb"
  target_key_id = aws_kms_key.dynamodb[0].key_id
}

resource "aws_dynamodb_table" "activity" {
  count = var.manage_activity_table ? 1 : 0

  name         = "${var.project_name}-activity-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "timestamp#type"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "timestamp#type"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.dynamodb[0].arn
  }

  tags = {
    Name = "${var.project_name}-activity"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_iam_role_policy" "apprunner_dynamodb" {
  name = "DynamoDBActivity"
  role = aws_iam_role.apprunner_instance.id

  # Mirrors the policy applied out-of-band on the original deployment exactly,
  # so terraform apply can take ownership without changing live permissions.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:GetItem",
      ]
      Resource = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.id}:table/${var.project_name}-activity-${var.environment}"
    }]
  })
}
