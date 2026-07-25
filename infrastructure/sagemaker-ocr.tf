# ─── Specialist OCR endpoints (self-hosted, OPT-IN, disabled by default) ──────
#
# Deploys the olmOCR-bench document-OCR models as SageMaker real-time endpoints so
# they can be compared against the Bedrock methods on your own documents.
#
# WHY THIS IS OFF BY DEFAULT
# --------------------------
# Every endpoint is a GPU instance that bills BY THE HOUR whether or not it serves a
# single request:
#
#   ml.g6e.2xlarge  (L40S 48GB)         ~$2.24/hr  ≈ $1,630/month
#   ml.g7e.4xlarge  (RTX PRO 6000 96GB) ~$7.09/hr  ≈ $5,170/month
#
# Enabling all six would add roughly $10k-30k/month to a demo stack. So this file
# creates NOTHING unless you set `enable_sagemaker_ocr = true` and list the models you
# want. Destroy them when you finish demoing.
#
# WHAT THE BENCHMARKS SAY (336 real scanned pages, name-matching F1 vs ground truth)
# ---------------------------------------------------------------------------------
#   infinity-parser2  35B    F1 0.640  — the ONLY model that splits every dense grid
#   dots-mocr          3B    F1 0.730* — best precision, but loops on dense pages
#   surya-ocr-2     0.65B    F1 0.670  — highest recall (0.958), collapses grids
#   chandra-ocr-2    5.3B    F1 0.670  — highest recall (0.960), collapses grids
#   baidu-unlimited  3B      F1 0.621  — cheapest/image, handles ~70% of pages
#   * over the 182/336 pages it completed, so easy-page biased.
#
# Aggregate F1 is MISLEADING here: surya/chandra score well on recall while failing
# the dense grids that actually distinguish these models. Baidu + Infinity are
# COMPLEMENTARY (Baidu handles most pages, Infinity recovers the ones Baidu collapses),
# which is why the reference production pipeline is Baidu -> judge -> Infinity fallback
# rather than any single model.
#
# PREREQUISITES
# -------------
# The container image and model artifact are NOT built here — building a vLLM/
# transformers OCR image is outside this stack's scope. Build and push them first
# (see the deploy/ directory of the hybrid vision + spatial reasoning study), then
# point `sagemaker_ocr_models` at the results.

variable "enable_sagemaker_ocr" {
  description = <<-EOT
    Master switch for the specialist OCR endpoints. FALSE by default.

    These are GPU endpoints billed hourly even when idle (~$2.24-$7.09/hr each), so
    nothing is created unless you deliberately turn this on. Leaving it off keeps the
    methods visible in the catalog, reported as "endpoint not configured" with their
    benchmark numbers, which is the honest state for a demo deployment.
  EOT
  type        = bool
  default     = false
}

variable "sagemaker_ocr_models" {
  description = <<-EOT
    Models to deploy, keyed by short name. Empty by default.

    Each entry needs a container image URI and a model artifact in S3 — this stack does
    not build them. `instance_type` defaults to ml.g6e.2xlarge, the cheapest per image
    of the two measured options ($0.0085/image vs $0.0122 on ml.g7e.4xlarge, which is
    faster in wall-clock but 31% more per image because it costs 3.2x the hour for only
    2.2x the throughput).

    Concurrency note from the benchmark: a single GPU endpoint has essentially FIXED
    throughput — raising concurrency 1 -> 8 lifted throughput ~5% while per-request
    latency grew 5.8x, and a g6e.2xlarge crashed with OOM at concurrency 8. Scale by
    adding endpoints, not concurrency.

    Example:
      sagemaker_ocr_models = {
        infinity = {
          image_uri     = "<acct>.dkr.ecr.us-west-2.amazonaws.com/multi-ocr-vllm:latest"
          model_data    = "s3://sagemaker-us-west-2-<acct>/infinity-parser2/model.tar.gz"
          instance_type = "ml.g7e.12xlarge"
        }
      }
  EOT
  type = map(object({
    image_uri     = string
    model_data    = string
    instance_type = optional(string, "ml.g6e.2xlarge")
    env           = optional(map(string), {})
  }))
  default = {}
}

locals {
  # Nothing is created unless BOTH the switch is on and models are listed. Two
  # conditions on purpose: flipping the switch alone should not silently deploy, and
  # listing models while the switch is off should not either.
  sagemaker_ocr_active = var.enable_sagemaker_ocr ? var.sagemaker_ocr_models : {}
}

# Execution role for the endpoints: read the model artifact, write logs. Nothing else.
resource "aws_iam_role" "sagemaker_ocr" {
  count = length(local.sagemaker_ocr_active) > 0 ? 1 : 0

  name = "${var.project_name}-sagemaker-ocr-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sagemaker.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "sagemaker_ocr" {
  count = length(local.sagemaker_ocr_active) > 0 ? 1 : 0

  name = "ModelArtifactAndLogs"
  role = aws_iam_role.sagemaker_ocr[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Scoped to the buckets holding the listed artifacts, not s3:*.
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = distinct(flatten([
          for m in values(local.sagemaker_ocr_active) : [
            "arn:aws:s3:::${split("/", replace(m.model_data, "s3://", ""))[0]}",
            "arn:aws:s3:::${split("/", replace(m.model_data, "s3://", ""))[0]}/*",
          ]
        ]))
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "cloudwatch:PutMetricData",
        ]
        Resource = "*"
      },
      {
        # Pulling the container image.
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_sagemaker_model" "ocr" {
  for_each = local.sagemaker_ocr_active

  name               = "${var.project_name}-ocr-${each.key}-${var.environment}"
  execution_role_arn = aws_iam_role.sagemaker_ocr[0].arn

  primary_container {
    image          = each.value.image_uri
    model_data_url = each.value.model_data
    environment = merge({
      # Cap generation so a dense page cannot generate to full context and OOM the
      # GPU — dots.ocr in particular loops to 29K+ characters without an EOS on dense
      # grids, which is how it failed to finish the benchmark.
      MAX_TOKENS = "8192"
    }, each.value.env)
  }
}

resource "aws_sagemaker_endpoint_configuration" "ocr" {
  for_each = local.sagemaker_ocr_active

  name = "${var.project_name}-ocr-${each.key}-${var.environment}"

  production_variants {
    variant_name           = "AllTraffic"
    model_name             = aws_sagemaker_model.ocr[each.key].name
    initial_instance_count = 1
    instance_type          = each.value.instance_type
  }
}

resource "aws_sagemaker_endpoint" "ocr" {
  for_each = local.sagemaker_ocr_active

  name                 = "${var.project_name}-ocr-${each.key}-${var.environment}"
  endpoint_config_name = aws_sagemaker_endpoint_configuration.ocr[each.key].name

  tags = {
    # Tagged so the hourly GPU spend is attributable — these are by far the most
    # expensive resources this stack can create.
    CostCenter = "specialist-ocr-optin"
    Model      = each.key
  }
}

output "sagemaker_ocr_endpoints" {
  description = <<-EOT
    Deployed OCR endpoint names, to pass back as `sagemaker_ocr_endpoints` so the
    backend can invoke them. Empty when the feature is off, which is the default.
  EOT
  value       = { for k, v in aws_sagemaker_endpoint.ocr : k => v.name }
}
