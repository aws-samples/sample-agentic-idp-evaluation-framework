---
title: System architecture
description: How ONE IDP is deployed on AWS.
---

ONE IDP runs as a monorepo with three deployable tiers: a CloudFront-fronted SPA, an App Runner backend, and a Bedrock AgentCore runtime for the Strands agent.

## Monorepo layout

```
one-idp/
├── packages/
│   ├── shared/           # Types, capability SSOT, method info, helpers
│   ├── backend/          # Express + adapters + Strands agent server
│   ├── frontend/         # React + Vite + Cloudscape + ReactFlow
│   └── docs/             # Fumadocs (Next.js static export) — this site
├── infrastructure/       # Terraform (live deployment)
├── infrastructure-cdk/   # AWS CDK v2 TypeScript (parity)
├── reference/            # Third-party reference projects (git submodules)
└── test-samples/         # Sample documents for local evaluation
```

Build order: `shared → backend + frontend + docs` (the three after `shared` are parallel). The `@idp/shared` package provides the single source of truth for method IDs, pricing, capabilities, and every shared DTO.

## Live deployment (default)

The reference deployment at `your-domain.example.com` looks like this:

```
                     ┌──────────────────────┐
Route 53 ◄──────────►│  CloudFront          │
  (A + AAAA)         │  E36RCDEC932TZP      │
                     │                      │
                     │  /*         → S3     │
                     │  /docs/*    → S3     │
                     │  /api/*     → App    │
                     │             Runner   │
                     └──────────────────────┘
                            │
                            ├──── /*       ─────►  S3  one-idp-static-dev  (SPA bundle)
                            ├──── /docs/*  ─────►  S3  one-idp-static-dev/docs  (Fumadocs static export)
                            │
                            └──── /api/*  ──────►  App Runner  one-idp-backend-dev
                                                     │
                                                     │  AgentCore SDK
                                                     ▼
                                             Bedrock AgentCore Runtime
                                               one_idp_dev-2iwFLG8S4q

S3  one-idp-uploads-dev   ◄── user uploads (NFC-normalized, sanitized keys)
DynamoDB  one-idp-activity-dev  (PK=userId, SK=timestamp#type, PAY_PER_REQUEST)
```

### Component breakdown

| Component | Resource | Purpose |
|---|---|---|
| **Edge** | CloudFront distribution `E36RCDEC932TZP` | HTTPS termination, SPA caching, path-based origin routing, 60 s read / 30 s keepalive to App Runner. |
| **SPA** | S3 `one-idp-static-dev` | Vite-built React bundle at the root. |
| **Docs** | S3 `one-idp-static-dev/docs/*` | Fumadocs static export (this site). |
| **API** | App Runner `one-idp-backend-dev` | Express server, pluggable auth, adapters. |
| **Agent** | Bedrock AgentCore Runtime `one_idp_dev-2iwFLG8S4q` | Strands agent with closure-bound tools, HTTP protocol on port 8080. |
| **Image** | ECR `one-idp-backend` | Multi-arch (amd64 for App Runner + arm64 for AgentCore) via `docker buildx`. |
| **Build** | CodeBuild `one-idp-build` | Pulls source.zip from `s3://one-idp-uploads-dev/codebuild/source.zip`, builds and pushes images. |
| **Uploads** | S3 `one-idp-uploads-dev` | User documents + BDA output prefixes. |
| **Activity** | DynamoDB `one-idp-activity-dev` | Non-blocking activity tracking (upload/conversation/preview events). |

### Request flow

```
Browser  ──HTTPS──►  CloudFront  ──path split──►  S3 /docs  (static Fumadocs pages)
                                              │
                                              ├── S3 /    (SPA bundle)
                                              │
                                              └── App Runner /api/*
                                                        │
                                                        ├─ auth middleware (cognito|none)
                                                        ├─ rate limit
                                                        └─ routes:
                                                            /api/upload         → multer → S3
                                                            /api/conversation   → AgentCore SDK
                                                            /api/pipeline/*     → adapters (SSE)
                                                            /api/preview        → adapters (SSE)
                                                            /api/architecture/* → Bedrock Converse
                                                            /api/files/*        → S3 proxy
                                                            /api/admin/*        → DynamoDB queries
```

## IaC: Terraform and CDK

Both stacks are kept at parity. **Do not run them against the same account/region** — they will clobber each other's state.

### Terraform (default)

Lives in `infrastructure/`. Run:

```bash
cd infrastructure
terraform init -reconfigure \
  -backend-config="bucket=<your-state-bucket>" \
  -backend-config="key=one-idp/terraform.tfstate" \
  -backend-config="region=us-west-2"
make plan && make apply
```

The DynamoDB activity table is guarded by `manage_activity_table` (default `false` to avoid conflicts with the existing live deployment; set to `true` for fresh installs).

### CDK v2 (parity)

Lives in `infrastructure-cdk/`. Uses the official `aws-cdk-lib/aws-bedrockagentcore.CfnRuntime` construct. Tiers are split into:

- `lib/storage.ts` — S3 buckets.
- `lib/ecr.ts` — container registry.
- `lib/agent-runtime.ts` — AgentCore runtime.
- `lib/app-runner.ts` — backend service.
- `lib/edge.ts` — CloudFront + Route 53.
- `lib/activity-table.ts` — DynamoDB.

`RuntimeEndpoint` is intentionally **not** added (DEFAULT-only per design).

```bash
cd infrastructure-cdk
npm install
npx cdk deploy -c projectName=one-idp -c environment=dev -c authProvider=cognito -c bdaProfileArn="..."
```

## Environment variables

Backend (App Runner):

| Var | Default | Purpose |
|---|---|---|
| `AWS_REGION` | `us-west-2` | Primary region. |
| `AUTH_PROVIDER` | `none` (demo) / `cognito` | Auth backend. |
| `ALLOW_UNAUTHENTICATED` | `false` | Must be `true` to run `AUTH_PROVIDER=none` in `NODE_ENV=production`. |
| `S3_BUCKET` | `one-idp-uploads-dev` | Input bucket. |
| `S3_OUTPUT_PREFIX` | `bda-output/` | BDA output prefix. |
| `BDA_PROFILE_ARN` | — | Required for BDA / BDA+LLM methods. |
| `BDA_PROJECT_ARN` | `public-default` | Optional custom BDA project. |
| `CLAUDE_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | Default model for architecture + code gen. |
| `AGENTCORE_RUNTIME_ARN` | — | Preferred path for conversation endpoint. |
| `ADMIN_USERS` | `your-alias` | Comma-separated aliases with admin access. |

See [Deploy](/deploy) for the full procedure, and [Authentication](/auth) for the auth matrix.
