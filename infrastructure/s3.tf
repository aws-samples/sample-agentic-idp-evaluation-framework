# S3 bucket for document uploads and processing outputs
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-uploads-${var.environment}"
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  /*
   * `blocked_encryption_types` and `bucket_key_enabled` are declared explicitly to
   * match what S3 actually returns.
   *
   * Without them every `terraform plan` proposed removing `blocked_encryption_types
   * = ["SSE-C"]` and nulling `bucket_key_enabled` — values AWS sets server-side, not
   * drift we caused. Applying it would have WEAKENED the bucket (re-permitting
   * customer-provided-key encryption, which bypasses our KMS policy) and the very
   * next plan would show the same diff again, because AWS re-applies its default. A
   * plan that never converges also hides real drift in the noise.
   *
   * SSE-C stays blocked deliberately: a client supplying its own key would store
   * objects this account cannot decrypt or audit.
   */
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    blocked_encryption_types = ["SSE-C"]
    bucket_key_enabled       = false
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "cleanup-old-uploads"
    status = "Enabled"

    expiration {
      days = 30
    }

    filter {
      prefix = "uploads/"
    }
  }

  rule {
    id     = "cleanup-old-outputs"
    status = "Enabled"

    expiration {
      days = 30
    }

    filter {
      prefix = "outputs/"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = distinct(concat(
      ["http://localhost:5173"],
      var.cors_allowed_origins,
      var.domain_name != "" ? ["https://${var.domain_name}"] : [],
    ))
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
