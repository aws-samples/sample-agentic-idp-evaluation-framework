# S3 bucket for frontend static assets
resource "aws_s3_bucket" "static_assets" {
  bucket = "${var.project_name}-static-${var.environment}"
}

# S3 bucket for CloudFront access logs (CKV_AWS_86)
resource "aws_s3_bucket" "cloudfront_logs" {
  bucket = "${var.project_name}-cf-logs-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "cloudfront_logs" {
  bucket                  = aws_s3_bucket.cloudfront_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudfront_logs" {
  bucket = aws_s3_bucket.cloudfront_logs.id
  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket_public_access_block" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudFront Origin Access Control for S3
resource "aws_cloudfront_origin_access_control" "static_assets" {
  name                              = "${var.project_name}-static-oac"
  description                       = "OAC for ${var.project_name} frontend static assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Secret header to verify CloudFront → App Runner origin requests
resource "random_password" "cloudfront_secret" {
  length  = 32
  special = false
}

# CloudFront Distribution
# checkov:skip=CKV_AWS_174:Default CloudFront cert does not allow configurable minimum_protocol_version; custom-domain path below already sets TLSv1.2_2021.
# checkov:skip=CKV2_AWS_47:Sample code. Customers should attach a WAF ACL before production use — documented in README/THREAT_MODEL.
# nosemgrep: terraform.aws.security.aws-insecure-cloudfront-distribution-tls-version
resource "aws_cloudfront_distribution" "main" {
  # Access logging for security / audit trail (CKV_AWS_86)
  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.cloudfront_logs.bucket_domain_name
    prefix          = "cf/"
  }

  # S3 Origin for frontend static assets
  origin {
    domain_name              = aws_s3_bucket.static_assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.static_assets.id
    origin_id                = "S3-static"
  }

  # App Runner Origin for API (Express REST server)
  # App Runner → AgentCore (IAM auth) for agent invocations
  origin {
    domain_name = aws_apprunner_service.backend.service_url
    origin_id   = "AppRunner-API"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # Long-lived SSE responses from the backend need a generous read timeout.
      # These match the original deployment's tuned values.
      # Long-lived SSE responses: 60 s is the CloudFront default cap without a
      # service-quota increase. With `: keepalive\n\n` heartbeats every 15 s
      # the idle timer resets, so this is the MAX time between packets, not
      # total duration. Slow methods (Haiku on 146-page Pfizer ~100 s) still
      # finish fine because they stream incrementally. Request a quota bump
      # to 180 s via AWS Support if steady-state slow methods become common.
      origin_read_timeout      = 60
      origin_keepalive_timeout = 30
    }

    custom_header {
      name  = "X-CloudFront-Secret"
      value = random_password.cloudfront_secret.result
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  # API behavior - forward to App Runner
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "AppRunner-API"

    forwarded_values {
      query_string = true
      # Forward specific headers (NOT Host — App Runner rejects foreign Host headers)
      headers = [
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "Referer",
        "X-IDP-User",
      ]

      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
    compress               = false
  }

  # Default behavior - S3 static assets
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-static"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  # SPA fallback - serve index.html for 404 only.
  # Do NOT rewrite 403: API routes (/api/admin/*) legitimately return 403,
  # and rewriting to index.html breaks JSON parsing on the client.
  # S3 static assets get proper 404 via default_root_object + OAC + ListBucket.
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.domain_name == ""
    acm_certificate_arn            = var.domain_name != "" ? aws_acm_certificate_validation.main[0].certificate_arn : null
    ssl_support_method             = var.domain_name != "" ? "sni-only" : null
    minimum_protocol_version       = var.domain_name != "" ? "TLSv1.2_2021" : null
  }

  aliases = var.domain_name != "" ? [var.domain_name] : []

  tags = {
    Name = "${var.project_name}-cdn"
  }
}

# S3 bucket policy for CloudFront access
resource "aws_s3_bucket_policy" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        # ListBucket grants so missing objects return 404 (not 403).
        # This is required because we no longer map 403→index.html at the CloudFront layer.
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          aws_s3_bucket.static_assets.arn,
          "${aws_s3_bucket.static_assets.arn}/*",
        ]
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })
}
