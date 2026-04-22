# ============================================================================
# Amazon Bedrock Guardrail (managed PII detection + redaction)
#
# Creates a Guardrail configured with every managed PII entity type in ANONYMIZE
# action so the backend's `bedrock-guardrails` method produces useful hits on
# real documents. If you already have a Guardrail, set `manage_guardrail=false`
# and supply `bedrock_guardrail_id` / `bedrock_guardrail_version` instead.
# ============================================================================

locals {
  manage_guardrail = var.manage_guardrail

  # Every PII entity Bedrock Guardrails knows about. ANONYMIZE replaces the
  # matched substring with a typed token; BLOCK stops the inference entirely.
  # For IDP evaluation we want the match list + value, so ANONYMIZE is right.
  guardrail_pii_types = [
    "ADDRESS", "AGE", "AWS_ACCESS_KEY", "AWS_SECRET_KEY", "CA_HEALTH_NUMBER",
    "CA_SOCIAL_INSURANCE_NUMBER", "CREDIT_DEBIT_CARD_CVV",
    "CREDIT_DEBIT_CARD_EXPIRY", "CREDIT_DEBIT_CARD_NUMBER", "DRIVER_ID",
    "EMAIL", "INTERNATIONAL_BANK_ACCOUNT_NUMBER", "IP_ADDRESS",
    "LICENSE_PLATE", "MAC_ADDRESS", "NAME", "PASSWORD", "PHONE", "PIN",
    "SWIFT_CODE", "UK_NATIONAL_HEALTH_SERVICE_NUMBER",
    "UK_NATIONAL_INSURANCE_NUMBER", "UK_UNIQUE_TAXPAYER_REFERENCE_NUMBER",
    "URL", "USERNAME", "US_BANK_ACCOUNT_NUMBER", "US_BANK_ROUTING_NUMBER",
    "US_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER", "US_PASSPORT_NUMBER",
    "US_SOCIAL_SECURITY_NUMBER", "VEHICLE_IDENTIFICATION_NUMBER",
  ]
}

resource "aws_bedrock_guardrail" "idp_pii" {
  count = local.manage_guardrail ? 1 : 0

  name                      = "${var.project_name}-pii-${var.environment}"
  description               = "ONE IDP — managed PII detection and redaction guardrail."
  blocked_input_messaging   = "[Blocked: input contained restricted content]"
  blocked_outputs_messaging = "[Blocked: output contained restricted content]"

  sensitive_information_policy_config {
    dynamic "pii_entities_config" {
      for_each = local.guardrail_pii_types
      content {
        type   = pii_entities_config.value
        action = "ANONYMIZE"
      }
    }
  }

  tags = {
    Name        = "${var.project_name}-pii-${var.environment}"
    Environment = var.environment
  }
}

# Publish a numbered version every time the config changes so the backend can
# reference a stable version instead of always reading DRAFT.
resource "aws_bedrock_guardrail_version" "idp_pii" {
  count = local.manage_guardrail ? 1 : 0

  guardrail_arn = aws_bedrock_guardrail.idp_pii[0].guardrail_arn
  description   = "Managed by Terraform — ${timestamp()}"

  lifecycle {
    ignore_changes = [description]
  }
}

locals {
  effective_guardrail_id      = local.manage_guardrail ? aws_bedrock_guardrail.idp_pii[0].guardrail_id : var.bedrock_guardrail_id
  effective_guardrail_version = local.manage_guardrail ? aws_bedrock_guardrail_version.idp_pii[0].version : var.bedrock_guardrail_version
  effective_guardrail_arn     = local.manage_guardrail ? aws_bedrock_guardrail.idp_pii[0].guardrail_arn : (var.bedrock_guardrail_id != "" ? "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.id}:guardrail/${var.bedrock_guardrail_id}" : "")
}
