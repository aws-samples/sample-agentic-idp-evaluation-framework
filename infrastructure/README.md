# ONE IDP — Terraform Infrastructure

This directory contains the Terraform stack that provisions the full
ONE IDP platform in a single AWS account:

- **S3** — upload bucket (encrypted, versioned, CORS) + static asset bucket
- **ECR** — backend Docker image registry
- **App Runner** — HTTP tier (Express API; serves the web UI)
- **AgentCore Runtime** — agent tier (Strands agent in a separate container)
- **CloudFront** — CDN + CloudFront → App Runner/S3 routing
- **Route53 + ACM** — optional custom domain with HTTPS
- **DynamoDB** — activity/usage tracking (created out-of-band; see TODO)
- **IAM** — least-privilege roles for App Runner and AgentCore

The parallel CDK TypeScript stack lives in [`../infrastructure-cdk/`](../infrastructure-cdk/).
Both stacks produce the same runtime topology; pick one.

## Prerequisites

- Terraform `>= 1.6`
- AWS CLI configured with credentials for the target account
- A named AWS profile or `AWS_ACCESS_KEY_ID` + friends in the environment
- Docker (only needed for the CodeBuild-less bootstrap path)

## Quick start

```bash
cd infrastructure

# 1. Copy example tfvars and edit
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

# 2. Init. For a remote state backend, pass the bucket via -backend-config:
terraform init \
  -backend-config="bucket=<your-state-bucket>" \
  -backend-config="key=one-idp/terraform.tfstate" \
  -backend-config="region=us-west-2"
# Or remove the `backend "s3" {}` block in main.tf to use local state.

# 3. Plan and apply
terraform plan -out tfplan
terraform apply tfplan
```

## Variables

| Variable | Description | Default |
| --- | --- | --- |
| `aws_region` | AWS region for the stack | `us-west-2` |
| `environment` | Env name (dev/staging/prod) | `dev` |
| `project_name` | Resource name prefix | `one-idp` |
| `ecr_image_tag` | Docker image tag to deploy | `latest` |
| `domain_name` | Optional custom domain (e.g. `idp.example.com`) | `""` |
| `route53_zone_id` | Hosted zone ID (required iff `domain_name` set) | `""` |
| `cors_allowed_origins` | Origins allowed to upload to S3 | `["http://localhost:5173"]` |
| `claude_model_id` | Bedrock Claude inference profile | `us.anthropic.claude-sonnet-4-6` |
| `nova_model_id` | Bedrock Nova model ID | `us.amazon.nova-2-lite-v1:0` |
| `bda_profile_arn` | BDA standard profile ARN | `""` |
| `bda_project_arn` | BDA custom project ARN (optional) | `""` |
| `auth_provider` | `none` \| `midway` \| `cognito` | `none` |
| `cognito_user_pool_id` | Required when `auth_provider = cognito` | `""` |
| `cognito_client_id`   | Required when `auth_provider = cognito` | `""` |
| `admin_users` | Comma-separated admin aliases | `""` |

## Regional requirements

- **ACM + CloudFront** — certificate must be in `us-east-1`. The stack
  configures a second provider alias automatically; nothing to change.
- **Bedrock** — inference profiles (e.g. `us.anthropic.claude-*`) require
  Bedrock to be enabled in `aws_region` and in the cross-region profile.
- **AgentCore** — currently limited to a small set of regions. Verify
  availability before deploying.

## Backend image bootstrapping

The App Runner service and AgentCore runtime both pull from the same ECR
repository (`<project_name>-backend`). The first apply will create the repo
empty; the service will fail to start until an image is pushed:

```bash
# from repo root, after terraform apply
bash scripts/deploy-backend.sh   # build + push to ECR + trigger App Runner
```

(If that script does not exist yet, see `infra.md` for the manual flow.)

## Destroy

```bash
terraform destroy
# ECR is force_delete=false by default; if destroy fails, empty the repo first
```

## Migrating to CDK

The CDK stack at `../infrastructure-cdk/` produces an equivalent topology.
You can switch by importing resources into CDK, but the easier path is:

1. `terraform destroy` (non-prod only!)
2. `cd ../infrastructure-cdk && npm install && npx cdk deploy`

Never run both stacks against the same account/region simultaneously — the
resource name prefix is shared.
