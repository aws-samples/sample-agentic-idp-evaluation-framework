---
title: Deploying your own instance
description: Terraform and CDK paths for a customer-owned deployment.
---

Two supported paths: **Terraform** (the reference live deployment) and **CDK v2 TypeScript** (at parity). Pick one and stick with it — both provision the same topology and will fight over resources if you run both against the same account.

## Prerequisites

- AWS account with Bedrock enabled in your target region (`us-west-2` is the default).
- Claude Sonnet 4.6, Haiku 4.5, Opus 4.6, Nova 2 Lite (and optionally Nova 2 Pro preview, Nova Multimodal Embeddings in us-east-1) enabled in the Bedrock console.
- For BDA methods: a Bedrock Data Automation **profile ARN** (and optional project ARN).
- Node.js 20+, Python 3.11+, Docker (for CodeBuild locally or container builds).
- For custom-domain deployments: a Route 53 hosted zone + ACM certificate in `us-east-1`.

## Path A: Terraform

### 1. Configure a remote state backend

Create an S3 bucket (and optional DynamoDB lock table) for the state, then:

```bash
cd infrastructure
terraform init -reconfigure \
  -backend-config="bucket=<your-state-bucket>" \
  -backend-config="key=one-idp/terraform.tfstate" \
  -backend-config="region=us-west-2"
```

### 2. Set variables

Create `terraform.tfvars`:

```hcl
project_name           = "one-idp"
environment            = "dev"
region                 = "us-west-2"
domain_name            = "idp.example.com"      # optional
hosted_zone_id         = "Z1234567890ABC"        # optional
auth_provider          = "cognito"                # none | cognito
admin_users            = ["alice", "bob"]
manage_activity_table  = true                     # true for fresh installs
bda_profile_arn        = "arn:aws:bedrock:us-west-2:<acct>:data-automation-profile/default"
```

### 3. Plan and apply

```bash
make plan
make apply
```

The plan should show **0 adds / 2 safe in-place / 0 destroys** against an already-deployed environment. For a fresh install it will provision S3 buckets, DynamoDB, CloudFront, App Runner, AgentCore runtime, ECR, CodeBuild, and IAM.

### 4. Build and push the backend image

```bash
git archive --format=zip HEAD -o /tmp/source.zip
aws s3 cp /tmp/source.zip s3://<your-uploads-bucket>/codebuild/source.zip
aws codebuild start-build --project-name one-idp-build
# Wait for SUCCEEDED, then trigger App Runner redeploy:
aws apprunner start-deployment --service-arn <your-app-runner-arn>
```

### 5. Deploy the frontend and docs

```bash
npm run build -w packages/frontend -w packages/docs
aws s3 sync packages/frontend/dist s3://<your-static-bucket>/       --delete --exclude 'docs/*'
aws s3 sync packages/docs/out      s3://<your-static-bucket>/docs/  --delete
aws cloudfront create-invalidation --distribution-id <your-distribution-id> --paths '/*'
```

## Path B: CDK v2

```bash
cd infrastructure-cdk
npm install
npx cdk bootstrap                   # first time per account/region
npx cdk deploy \
  -c projectName=one-idp \
  -c environment=dev \
  -c authProvider=cognito \
  -c bdaProfileArn="arn:aws:bedrock:us-west-2:<acct>:data-automation-profile/default" \
  -c domainName="idp.example.com" \
  -c hostedZoneId="Z1234567890ABC"
```

CDK stacks under `lib/`:

- `storage-stack.ts` — S3 buckets.
- `ecr-stack.ts` — container registry.
- `agent-runtime-stack.ts` — `CfnRuntime` construct.
- `app-runner-stack.ts` — backend service + IAM.
- `edge-stack.ts` — CloudFront + Route 53.
- `activity-table-stack.ts` — DynamoDB.

After `cdk deploy` the ECR repo exists but is empty — push the first backend image via CodeBuild (same as the Terraform path), then trigger App Runner deployment.

## Post-deploy verification

Every fresh deployment should pass this checklist:

- [ ] `GET https://<your-domain>/` returns the SPA (`200 OK`, `text/html`).
- [ ] `GET https://<your-domain>/docs/` returns the docs home (`200 OK`, `text/html`).
- [ ] `GET https://<your-domain>/api/auth/me` returns `200` with your authenticated user (or `401` if you're unauthed and `AUTH_PROVIDER=cognito`).
- [ ] `POST https://<your-domain>/api/upload` with a small PDF returns `{ documentId, s3Uri }`.
- [ ] `POST https://<your-domain>/api/preview` with `{ documentId, capabilities, method: 'claude-haiku' }` streams SSE events.
- [ ] Admin endpoint `GET /api/admin/stats` returns `403` when unauthed and `200` when you're in `ADMIN_USERS`.
- [ ] Upload a Korean or non-ASCII filename, hit `/api/files/<key>`, verify it streams correctly.
- [ ] Path-traversal vectors (`..`, absolute, null byte) all return `404`.

## Tear-down

Terraform:

```bash
cd infrastructure && make destroy
```

CDK:

```bash
cd infrastructure-cdk && npx cdk destroy --all
```

S3 buckets with `RemovalPolicy.RETAIN` (the default) survive destroy — delete them manually if you want a clean slate.
