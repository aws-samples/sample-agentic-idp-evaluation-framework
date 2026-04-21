# ============================================================================
# ONE IDP — Terraform helpers
# ----------------------------------------------------------------------------
# Expects the following env vars (or pass on the command line):
#   TF_STATE_BUCKET   — S3 bucket for remote state (optional; local if unset)
#   TF_STATE_KEY      — state object key (default: one-idp/terraform.tfstate)
#   TF_REGION         — state bucket region (default: us-west-2)
# ============================================================================

TF_STATE_KEY ?= one-idp/terraform.tfstate
TF_REGION    ?= us-west-2

ifeq ($(TF_STATE_BUCKET),)
INIT_ARGS =
else
INIT_ARGS = -backend-config="bucket=$(TF_STATE_BUCKET)" \
            -backend-config="key=$(TF_STATE_KEY)" \
            -backend-config="region=$(TF_REGION)"
endif

.PHONY: help init plan apply destroy fmt validate output clean

help:
	@echo "Targets:"
	@echo "  init      — terraform init (pass TF_STATE_BUCKET for remote state)"
	@echo "  plan      — terraform plan -out tfplan"
	@echo "  apply     — terraform apply tfplan"
	@echo "  destroy   — terraform destroy"
	@echo "  fmt       — terraform fmt -recursive"
	@echo "  validate  — terraform validate"
	@echo "  output    — terraform output"
	@echo "  clean     — remove local .terraform/ and tfplan"

init:
	terraform init $(INIT_ARGS)

plan:
	terraform plan -out tfplan

apply:
	terraform apply tfplan

destroy:
	terraform destroy

fmt:
	terraform fmt -recursive

validate:
	terraform validate

output:
	terraform output

clean:
	rm -rf .terraform tfplan
