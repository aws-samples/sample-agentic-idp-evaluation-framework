# ONE IDP — Intelligent Document Processing Evaluation Platform

Evaluate, compare, and recommend the optimal AWS document processing approach for your use case.

Upload a sample document, answer a few targeted questions, and watch 13+ processing methods run in parallel across 33 capabilities — with real accuracy, cost, and speed comparisons, then generate a production-ready architecture (Terraform or CDK).

## Features

- **33 capabilities** across 8 categories: Core Extraction, Visual Analysis, Document Intelligence, Compliance & Security, Industry-Specific, Media Processing, Advanced AI, Document Conversion
- **13+ processing methods** across 5 families: BDA (Standard / + LLM hybrids), Claude (Sonnet 4.6 / Haiku 4.5 / Opus 4.6), Nova (2 Lite GA / 2 Pro Preview), Textract+LLM, Amazon Comprehend + Bedrock Guardrails (for PII)
- **18 document types** covered by test fixtures — PDF, Office, image, audio, video
- **Pipeline builder** — ReactFlow node graph for custom processing pipelines; chat interface to modify pipelines conversationally
- **Real-time SSE streaming** — token-level progress for every method, 15s keepalive
- **Architecture recommendations** — cost projections at scale, generated IaC in Terraform or CDK
- **Pluggable auth** — `none` (demo), Midway (AWS internal), Cognito (real JWT verifier against a user pool)

## Quick Start (local dev)

```bash
# 1. Install
npm install

# 2. Configure — copy template and fill in your AWS values
cp .env.example .env
# Minimum .env for local demo:
#   AWS_REGION=us-west-2
#   USE_LOCAL_STORAGE=true
#   AUTH_PROVIDER=none
#   BDA_PROFILE_ARN=arn:aws:bedrock:us-west-2:<account>:data-automation-profile/us.data-automation-v1  (optional)

# 3. Build shared types (required once, and after any skills/capability changes)
npm run build -w packages/shared

# 4. Start dev servers (backend :3001 + frontend :5173)
npm run dev
```

Open http://localhost:5173.

### Verified end-to-end locally

With AWS credentials and Bedrock enabled in your region:

```bash
# Upload a sample and run Claude Haiku 4.5 text extraction
curl -sX POST -F "file=@test-samples/04-tax-receipt-pii.pdf" \
  http://localhost:3001/api/upload

# Response: { "documentId": "...", "s3Uri": "local:///...", "previewUrl": "/api/files/..." }

curl -sX POST -N http://localhost:3001/api/preview \
  -H "Content-Type: application/json" \
  -d '{"documentId":"<id>","s3Uri":"local:///...","capabilities":["text_extraction"],"methods":["claude-haiku"]}'
# → SSE: preview_start → method_result → preview_done
```

Tested this session against a Korean 부가가치세 신고서 PDF — full text extracted, confidence 0.95, cost $0.0118 (2460 in / 1866 out tokens, ~19s latency).

## Project structure

```
one-idp/
├── packages/
│   ├── shared/               # Shared types, capability/skill defs, generated from skills/*.md
│   ├── backend/              # Express API + Strands agent server + adapters
│   │   └── src/middleware/
│   │       ├── auth.ts         # Pluggable auth dispatcher (none|midway|cognito)
│   │       ├── auth-cognito.ts # Real JWT verifier (jose + JWKS)
│   │       ├── midway.ts       # AWS-internal Midway validation
│   │       └── upload.ts       # multer: 50MB limit + mimetype allowlist
│   └── frontend/             # React 18 + Vite + Cloudscape + ReactFlow
├── infrastructure/           # Terraform stack (App Runner + AgentCore + CloudFront + S3 + DynamoDB)
├── infrastructure-cdk/       # AWS CDK TypeScript stack (parity with Terraform)
├── test-samples/             # 18 real test documents + coverage results
├── docs/
│   └── architecture.md       # 3-tier topology, auth boundary, deploy lifecycle
└── reference/                # Third-party IDP reference projects (not published by default)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, Cloudscape Design, ReactFlow, Lucide Icons |
| Backend | Node.js 20, Express 4, TypeScript 5 |
| AI/ML | Amazon Bedrock (Claude, Nova), BDA, Amazon Textract, Amazon Comprehend |
| Agent runtime | Strands Agents TypeScript SDK on Bedrock AgentCore |
| Auth | Pluggable: `none` / Midway / Cognito (real JWT verifier via `jose`) |
| Storage | Amazon S3 (KMS, versioned, CORS) or local `.local-uploads/` |
| Activity | DynamoDB pay-per-request |
| Deploy | App Runner + Bedrock AgentCore Runtime + CloudFront + Route53/ACM |
| IaC | Terraform `>= 1.6` **and** AWS CDK v2 (pick one) |

## Processing methods

| Family | Models | Pricing |
|--------|--------|---------|
| **BDA** | Standard, Custom Blueprint | $0.01 / $0.04 per page |
| **BDA + LLM** | +Sonnet, +Haiku, +Nova Lite | BDA page + LLM tokens |
| **Claude** | Sonnet 4.6, Haiku 4.5, Opus 4.6 | $1 – $5 input / $5 – $25 output per 1M tokens |
| **Nova** | 2 Lite (GA), 2 Pro (Preview) | $0.30 – $1.25 / 1M input tokens |
| **Textract + LLM** | +Sonnet, +Haiku, +Nova Lite, +Nova Pro | $0.0015/page + LLM tokens |
| **Comprehend / Guardrails** | PII detection only | pay-per-request |

## Environment variables

Full list in [`.env.example`](.env.example). Highlights:

| Var | Default | Notes |
| --- | --- | --- |
| `AWS_REGION` | `us-west-2` | |
| `S3_BUCKET` | *(empty)* | Required unless `USE_LOCAL_STORAGE=true` |
| `USE_LOCAL_STORAGE` | *(unset)* | `true` → uses `.local-uploads/` instead of S3 |
| `AUTH_PROVIDER` | `none` | `none` \| `midway` \| `cognito` |
| `ALLOW_UNAUTHENTICATED` | *(unset)* | Only with `AUTH_PROVIDER=none` + `NODE_ENV=production`. Otherwise boot is refused. |
| `ADMIN_USERS` | `''` | Comma-separated aliases. Ignored when `AUTH_PROVIDER=none`. |
| `COGNITO_USER_POOL_ID` | *(empty)* | Required when `AUTH_PROVIDER=cognito` |
| `COGNITO_CLIENT_ID` | *(empty)* | Optional allowlist, comma-separated |
| `BDA_PROFILE_ARN` / `BDA_PROJECT_ARN` | *(empty)* | Optional — BDA methods unavailable if unset |
| `CLAUDE_MODEL_ID` / `NOVA_MODEL_ID` | GA defaults | Override for regional variants |
| `VITE_APP_TITLE` | `ONE IDP Framework` | Frontend top-nav title |
| `VITE_REPO_URL` / `VITE_CHAT_URL` | *(unset)* | Source / chat links. **Shown only in dev builds** by default (`import.meta.env.DEV`). Set `VITE_SHOW_LINKS=true` at build time to force-show in prod. |

## Deployment

Two equivalent IaC stacks. Pick one — do **not** run both against the same account/region.

| Stack | Path | Tooling |
| --- | --- | --- |
| Terraform | [`infrastructure/`](infrastructure/) | `>= 1.6` |
| CDK (TypeScript) | [`infrastructure-cdk/`](infrastructure-cdk/) | AWS CDK v2 |

Both produce the same 3-tier topology (see [docs/architecture.md](docs/architecture.md)):

- **Edge tier** — CloudFront + optional Route53 + ACM
- **Web tier** — App Runner (Express API, pluggable auth)
- **Agent tier** — Bedrock AgentCore Runtime (Strands agent, IAM SigV4 only)

```bash
# Terraform
cd infrastructure
cp terraform.tfvars.example terraform.tfvars
# For existing deployments preserving state:
terraform init -reconfigure \
  -backend-config="bucket=<your-state-bucket>" \
  -backend-config="key=one-idp/terraform.tfstate" \
  -backend-config="region=us-west-2"
make plan && make apply     # or: terraform plan -out tfplan && terraform apply tfplan

# CDK
cd infrastructure-cdk
npm install
npx cdk deploy \
  -c projectName=one-idp -c environment=dev \
  -c authProvider=midway \
  -c bdaProfileArn="arn:aws:bedrock:us-west-2:<account>:data-automation-profile/us.data-automation-v1"
```

See [`infrastructure/README.md`](infrastructure/README.md) and [`infrastructure-cdk/README.md`](infrastructure-cdk/README.md) for variable references and migration notes.

## Authentication

The backend ships with a pluggable `AUTH_PROVIDER`:

- **`none`** — demo mode; synthetic anonymous user.
  - Refuses to boot in `NODE_ENV=production` unless `ALLOW_UNAUTHENTICATED=true` is set explicitly.
  - Admin endpoints (`/api/admin/*`) are **always denied** when `AUTH_PROVIDER=none`, regardless of `ADMIN_USERS`.
- **`midway`** — AWS internal only. Validates the `midway-id-token` cookie (JWT payload) OR `x-midway-user` header (trusted only when set by an upstream Midway-aware CloudFront/ALB).
  - Legacy `MIDWAY_DISABLED=true` is still honored as an alias for `AUTH_PROVIDER=none`.
- **`cognito`** — real JWT verifier using [`jose`](https://github.com/panva/jose). Fetches the user pool JWKS, verifies signature + issuer + expiry + `token_use`, and optionally checks `client_id` against `COGNITO_CLIENT_ID` allowlist. Accepts both ID and access tokens.

Switch providers without code changes via env vars alone. The dispatcher lives in [`packages/backend/src/middleware/auth.ts`](packages/backend/src/middleware/auth.ts).

## Security

### Hardening applied to this repo

- **Path-traversal defense** — `/api/files/*` rejects keys with `..`, leading `/`, or null bytes before touching the backend. `getLocalFilePath` additionally resolves absolute paths and verifies containment within `.local-uploads/`.
- **Filename sanitization** — uploaded filenames are NFC-normalized and stripped of path separators / control characters before being used as S3 keys.
- **Upload limits** — `multer` caps body size at 50MB and enforces a mimetype allowlist from `@idp/shared`.
- **Admin defense-in-depth** — admin middleware refuses access when auth is disabled (`AUTH_PROVIDER=none`), even if aliases match. Empty `ADMIN_USERS` also blocks all admins.
- **Fail-closed prod boot** — `NODE_ENV=production` + unauth provider → backend throws on startup unless `ALLOW_UNAUTHENTICATED=true` is explicitly set.
- **Header-trust boundary documented** — `midway.ts` has inline security comment stating the `x-midway-user` trust assumption (must be stripped by the edge).
- **IAM least-privilege** — bucket-scoped S3 ARNs, agent-scoped AgentCore invoke ARNs. The few remaining `Resource: "*"` policies are standard Bedrock/Textract usage.
- **JWT verification** — Cognito path uses `jose.jwtVerify` against the live JWKS, not a homegrown parser.

### Known trust assumptions / TODOs for public release

- Midway path trusts the edge. If you deploy behind plain App Runner, set `AUTH_PROVIDER=cognito` or `none` — not `midway`.
- Rate limiter is per-IP in-memory — use Redis or an edge WAF for real traffic.
- CloudFront origin has an `X-CloudFront-Secret` header but the Express backend does not currently verify it. Add verification before opening App Runner to the internet, or restrict via VPC.
- `.omc/` was tracked in earlier commits (now gitignored). Consider `git filter-repo` before public publication.

## Verified end-to-end (this session)

| Check | Result |
| --- | --- |
| `npm run build` across all 3 workspaces | ✅ |
| `cdk synth` | ✅ (no warnings) |
| `terraform plan` against live state | ✅ 0 creates / 2 safe in-place / 0 destroy |
| Upload → file proxy → preview (Claude Haiku) | ✅ Korean PDF, full extraction |
| Auth `none` / `midway` / `cognito` dispatch | ✅ All three paths verified |
| Path traversal (`..`, absolute, null byte) | ✅ 404 |
| Admin with `AUTH_PROVIDER=none` | ✅ 403 |

## License

MIT-0. See [LICENSE](LICENSE).
