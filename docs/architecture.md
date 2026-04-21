# ONE IDP — Architecture

This document describes the runtime topology and the tier boundaries.
It applies to both the Terraform stack (`infrastructure/`) and the
CDK stack (`infrastructure-cdk/`); the two produce equivalent topology.

## Three tiers

```
        ┌────────────────────────────────────────────────────────┐
        │                    CloudFront (Edge tier)              │
        │                                                        │
        │   GET /*          → S3 static assets (SPA, React)      │
        │   * /api/*        → App Runner (web tier, HTTPS)       │
        └──────────────┬─────────────────────────────────────────┘
                       │
                       ▼
        ┌────────────────────────────────────────────────────────┐
        │                 App Runner (Web tier)                  │
        │   Express HTTP API — auth, upload, orchestration       │
        │   Pluggable auth via AUTH_PROVIDER:                    │
        │      none | midway | cognito                           │
        │                                                        │
        │   Proxies agent calls via SigV4                        │
        │       ▼                                                │
        │                                                        │
        │   Also calls directly (fast path, no agent):           │
        │     - Bedrock Runtime   (Claude/Nova streaming)        │
        │     - BDA Runtime       (document automation)          │
        │     - Textract          (OCR)                          │
        └──────────────┬─────────────────────────────────────────┘
                       │ bedrock-agentcore:InvokeAgentRuntime
                       ▼
        ┌────────────────────────────────────────────────────────┐
        │            Bedrock AgentCore (Agent tier)              │
        │   Strands agent — long-running, tool-using workflows   │
        │   Same container image as web tier, SERVER_MODE=agent  │
        │   Runs on port 8080 with HTTP protocol configuration   │
        └──────────────┬─────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────────────────────────────┐
        ▼              ▼                      ▼                   ▼
   Bedrock          BDA                    Textract            S3 uploads
   (models)      (automation)              (OCR)           (KMS, versioned)
```

## Why three tiers

**Edge tier (CloudFront + S3 + Route53 + ACM)** — cache static assets,
terminate TLS for a custom domain, route `/api/*` to App Runner. Stateless
and independent of application code.

**Web tier (App Runner)** — always-on HTTP surface. Cheap to scale because
it only holds short-lived request state. Runs Express with pluggable auth
middleware. Its job is to:
1. Authenticate the user.
2. For simple synchronous requests, call AWS services directly.
3. For agent workflows, delegate to the agent tier.

**Agent tier (Bedrock AgentCore Runtime)** — container purpose-built for
long-running, tool-using agent invocations. Has its own IAM execution
role, its own scaling model, and its own deployment lifecycle. Runs the
same container image as the web tier with `SERVER_MODE=agent`.

### Why separate the two compute tiers

- The agent workload has different performance characteristics than
  the API tier (longer-lived requests, multi-step tool use, streaming).
  Scaling them together wastes compute.
- AgentCore provides managed primitives that App Runner does not:
  workload identity tokens, agent runtime versioning/endpoints, built-in
  X-Ray + metrics namespace, long-lived streaming.
- The web tier should never be the only thing between the public internet
  and the agent — AgentCore's IAM-authenticated invocation adds a second
  layer of defense.

## Container layout

```
backend Docker image
├── SERVER_MODE=main  → start Express API on PORT=3001      (App Runner)
└── SERVER_MODE=agent → start agent server on AGENT_PORT=8080 (AgentCore)
```

The dispatch is done in `packages/backend/entrypoint.sh` based on the
`SERVER_MODE` environment variable. App Runner sets it implicitly via its
own env vars; AgentCore sets it via the runtime environment variables
defined in the Terraform / CDK stack.

## Authentication

The web tier is the only tier that terminates user auth. AgentCore runtime
is called via IAM SigV4 — **there is no path for user credentials to reach
the agent tier**. This means:

- The agent tier trusts the web tier (by account ID + IAM role).
- The web tier is responsible for authorization checks before it delegates.
- A bug in `packages/backend/src/middleware/auth.ts` cannot be papered over
  by the agent tier — treat it as a critical boundary.

Providers:

| `AUTH_PROVIDER` | Behavior |
| --- | --- |
| `none` | Demo mode. Refuses to boot in `NODE_ENV=production` unless `ALLOW_UNAUTHENTICATED=true`. |
| `midway` | AWS internal. Uses the Midway cookie / `x-midway-user` header set by the Midway-aware CloudFront/ALB. |
| `cognito` | Stub. Implement JWT verification against your user pool in `middleware/auth-cognito.ts`. |

## Data plane

- **Uploads bucket**: KMS-encrypted, versioned, 30-day lifecycle on
  `uploads/` and `outputs/`. CORS allowlist is configurable per environment.
- **Activity table**: DynamoDB (provision separately for now; Terraform
  TODO). Tracks usage and admin-page metrics.
- **Static assets bucket**: accessed only through CloudFront via OAC.
  Direct public access is blocked.

## Deployment lifecycle

1. **First deploy** (Terraform or CDK):
   1. Creates ECR repository (empty).
   2. Creates App Runner service + AgentCore runtime, both pointing at
      `:latest` — which does not exist yet. Both services will fail health
      checks until an image is pushed.
   3. Build and push the image (`scripts/deploy-backend.sh` or similar).
   4. App Runner auto-pulls; trigger a manual AgentCore update if needed.

2. **Subsequent deploys**:
   - Code change → rebuild image → push → App Runner auto-deploys (if
     `auto_deployments_enabled=true`; default here is `false`) or you
     trigger via `aws apprunner start-deployment`. AgentCore picks up the
     new image on its next runtime update.

## Observability

- CloudWatch Logs — `/aws/apprunner/*` and
  `/aws/bedrock-agentcore/runtimes/*`
- X-Ray tracing — enabled in the AgentCore execution policy
- Custom CloudWatch metric namespace `bedrock-agentcore`

## References

- AgentCore samples (official): <https://github.com/awslabs/agentcore-samples>
  - CDK TypeScript: `cdk/typescript/knowledge-base-rag-agent`
  - Terraform basic runtime: `04-infrastructure-as-code/terraform/basic-runtime`
