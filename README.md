# ONE IDP Evaluation Framework

Find the best AWS document processing method for your documents — by running them all
and comparing real cost, speed and accuracy.

Upload one real document. An advisor reads it and suggests what to extract, then every
applicable method runs **in parallel on your document** — 29 methods across 33
capabilities — so the comparison is measured rather than assumed. Finish with a
deployable project (Python, TypeScript and CDK) wired to the methods you picked.

<!--
  Steps 1-4 on a real invoice, recorded from a live deployment at 1920x1200 by
  `scripts/record-walkthrough.mjs`. It drives the real app in Chromium — nothing is mocked
  or staged, so the recording cannot drift from the product.

  The opening frame is a title card, and that is not decoration: GitHub renders the embed
  with `controls` but emits NO `poster` attribute, and markdown gives no way to supply one,
  so whatever is in frame 0 is the thumbnail every visitor sees before pressing play. It
  used to be a blank white rectangle. The card now carries the pitch plus a real screenshot
  of the comparison (19 methods with measured latencies) taken from that same run, so the
  still frame is evidence rather than a claim.

  This is a GitHub user-attachments URL, NOT a file in this repo, and that is deliberate:
  a committed `<video src="docs/images/walkthrough.mp4">` does not render on github.com.
  Only assets uploaded through GitHub's own UI get a player. Two more constraints that are
  easy to trip over:
    - the URL must sit ALONE on its own line. Wrapping it in <p>, <a> or markdown link
      syntax makes GitHub skip it and render nothing.
    - it therefore cannot be centred or captioned inline; the caption goes underneath.
  To replace it: run the record script, drag the resulting mp4 into any issue or PR comment
  on github.com, and paste the URL it returns here.
-->

https://github.com/user-attachments/assets/0daf769d-c1aa-4933-8745-7ec91e489b31

<p align="center">
  <em>Steps 1–4 on a real invoice — upload, compare every applicable method in parallel,
  build a pipeline, then generate deployable architecture and code.
  Recorded from a live deployment.</em>
</p>

## What you get

| Step | What happens | What you get |
| --- | --- | --- |
| **1 · Upload** | One real document — PDF, image, Word, Excel, PowerPoint, audio or video. | Everything after this is measured on *your* document, not a sample. |
| **2 · Analyze & Compare** | An advisor reads the document and suggests what to extract. Every applicable method then runs **in parallel**. | Real cost, latency and output side by side — including which methods returned nothing, and which got cut off at their token limit. |
| **3 · Build Pipeline** | Assemble the winners into a pipeline and run it end to end. | What a production run actually produces and costs, not an estimate. |
| **4 · Architecture & Code** | Generate a deployable project wired to the methods you picked. | 11 files — Python, TypeScript, a CDK app and a README — plus cost projections at 1k / 10k / 100k docs per month. |

## Architecture at a glance

| Tier | What it does | AWS services |
| --- | --- | --- |
| **01 Edge** | TLS termination, DNS, CDN, SPA delivery | Route 53 · ACM · CloudFront · WAF · S3 (SPA bucket) |
| **02 Web** — ECS Fargate | Stateless Express API, SSE streaming, Cognito auth, HPA on CPU &amp; RPS | ALB · ECS Fargate (2–10 tasks, 1 vCPU / 2 GB, `awsvpc`) · ECR · Secrets Manager · CloudWatch Logs · X-Ray |
| **03 Agent** — Strands on AgentCore | Socratic advisor; closure-bound tools `analyze_document()`, `recommend_capabilities()`, `generate_architecture()` — invoked via SigV4 only | Bedrock AgentCore Runtime (arm64, SSE) |
| **04 AI Services** | 10 families · 29 methods · script-aware routing · sequential Guardrails composition for PII | Amazon Bedrock (Claude Sonnet 4.6/5, Haiku 4.5, Opus 4.6/4.7/4.8/5, Nova 2 Lite, GPT-5.5/5.6 via Mantle, Nova Embeddings, Guardrails, TwelveLabs Pegasus for video) · Bedrock Data Automation (up to 3 000 pages per job) · Amazon Textract (`DetectDocumentText` only, by design — see below) · optional self-hosted OCR on SageMaker |
| **05 Data** | Uploads, activity tracking, Terraform state, KMS encryption, async fan-out | S3 Uploads · DynamoDB · SQS · S3 TF State · KMS |

Three architectural principles worth calling out:

- **Least-privilege IAM everywhere.** Bucket-scoped S3 ARNs, agent-scoped `InvokeAgentRuntime`, per-model foundation-model ARNs. `AUTH_PROVIDER=none` refuses to boot in production unless `ALLOW_UNAUTHENTICATED=true` is set explicitly.
- **IaC parity.** Terraform (`infrastructure/`) and AWS CDK v2 (`infrastructure-cdk/`) both produce the same five-tier topology. Do not run both against the same account / region.
- **Data-driven method routing.** The Socratic agent recommends capabilities on the first turn; the comparison dashboard runs every compatible method in parallel and feeds actual preview metrics back into the pipeline generator. PII capabilities fall through to Bedrock Guardrails and chain sequentially behind the extraction stage.

## Features

- **33 capabilities** across 8 categories: Core Extraction, Visual Analysis, Document Intelligence, Compliance & Security, Industry-Specific, Media Processing, Advanced AI, Document Conversion
- **29 processing methods** across 10 families:
  - **BDA** — Standard, plus three BDA→LLM structuring hybrids
  - **Claude** — Sonnet 4.6, Sonnet 5, Haiku 4.5, Opus 4.6, Opus 4.7, Opus 4.8, Opus 5
  - **Nova** — Nova 2 Lite · **GPT** — GPT-5.5 and three GPT-5.6 tiers via Bedrock Mantle
  - **Textract+LLM** — OCR then structuring, with Sonnet 4.6 / Haiku 4.5 / Nova 2 Lite
  - **Nova Embeddings** · **Bedrock Guardrails** (PII specialist)
  - **TwelveLabs Pegasus 1.2** — video understanding, offered only for video input
  - **Specialist OCR on SageMaker** — six self-hosted models (Infinity-Parser2, Baidu,
    Surya 2, Chandra 2, dots.ocr, Qwen3-VL), **off by default** because each needs a
    GPU endpoint billed by the hour even when idle
- **Measured, not assumed** — a method that returns nothing is reported as a failure, and
  a response cut off at the token ceiling is flagged rather than shown as complete
- **Script-aware routing** — Korean, Japanese, Chinese, Arabic and other non-Latin
  documents are routed on detected script, because OCR-first methods measured 32–42%
  token recall on Hangul where direct-vision methods measured 100%
- **Pipeline builder** — ReactFlow node graph for custom processing pipelines; chat
  interface to modify pipelines conversationally
- **Real-time SSE streaming** — token-level progress for every method, 15s keepalive
- **Architecture & code** — cost projections at scale plus an 11-file deployable project
  (Python, TypeScript, CDK). The framework itself ships both Terraform and CDK.
- **Admin dashboard** — usage stats, evaluation runs with click-to-detail, activity log
- **Pluggable auth** — `none` (demo), Amazon Cognito (real JWT verifier against a user pool)
- **Run history** — save and reload past sessions. **Disabled by default**
  (`DISABLE_RUN_HISTORY=true`) and refused server-side, because with `AUTH_PROVIDER=none`
  every visitor shares one alias and would otherwise see each other's documents. Enable
  it only on a deployment with real per-user auth.

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

## Project structure

```
one-idp/
├── packages/
│   ├── shared/               # Shared types, capability/skill defs, generated from skills/*.md
│   ├── backend/              # Express API + Strands agent server + adapters
│   │   └── src/middleware/
│   │       ├── auth.ts         # Pluggable auth dispatcher (none|cognito)
│   │       ├── auth-cognito.ts # Real JWT verifier (jose + JWKS)
│   │       └── upload.ts       # multer: 50MB limit + mimetype allowlist
│   └── frontend/             # React 18 + Vite + Cloudscape + ReactFlow
├── infrastructure/           # Terraform stack (ECS Fargate + AgentCore + CloudFront + S3 + DynamoDB)
├── infrastructure-cdk/       # AWS CDK TypeScript stack (parity with Terraform)
├── test-samples/             # Test documents (gitignored — add your own samples)
└── docs/
    └── architecture.md       # 3-tier topology, auth boundary, deploy lifecycle
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, Cloudscape Design, ReactFlow, Lucide Icons |
| Backend | Node.js 20, Express 4, TypeScript 5 |
| AI/ML | Amazon Bedrock (Claude, Nova), BDA, Amazon Textract, Amazon Comprehend |
| Agent runtime | Strands Agents TypeScript SDK on Bedrock AgentCore |
| Auth | Pluggable: `none` (local dev) / Amazon Cognito (production, real JWT verifier via `jose`) |
| Storage | Amazon S3 (KMS, versioned, CORS) or local `.local-uploads/` |
| Activity | DynamoDB pay-per-request |
| Deploy | ECS Fargate + Bedrock AgentCore Runtime + CloudFront + Route53/ACM |
| IaC | Terraform `>= 1.6` **and** AWS CDK v2 (pick one) |

## Processing methods

29 methods in 10 families. The catalog is the single source of truth
(`packages/shared/src/types/processing.ts`); `GET /api/methods` reports what a given
deployment can actually run, and why anything is unavailable.

| Family | Methods | Pricing |
|--------|---------|---------|
| **BDA** | Standard, Custom Blueprint | $0.01 / $0.04 per page |
| **BDA + LLM** | +Sonnet 4.6, +Haiku 4.5, +Nova 2 Lite | BDA page fee + LLM tokens |
| **Claude** | Sonnet 4.6, Sonnet 5, Haiku 4.5, Opus 4.6, Opus 4.7, Opus 4.8, Opus 5 | $1 – $5 in / $5 – $25 out per 1M tokens |
| **Nova** | Nova 2 Lite | $0.30 / 1M input tokens |
| **GPT** (Bedrock Mantle) | GPT-5.5, GPT-5.6 Sol / Terra / Luna | per-tier token pricing |
| **Textract + LLM** | +Sonnet 4.6, +Haiku 4.5, +Nova 2 Lite | $0.0015/page + LLM tokens |
| **Nova Embeddings** | embedding generation | per 1M tokens |
| **Guardrails** | PII detection / redaction only | pay-per-request |
| **Video understanding** | TwelveLabs Pegasus 1.2 | per second of video |
| **Specialist OCR** (SageMaker, opt-in) | Infinity-Parser2, Baidu, Surya 2, Chandra 2, dots.ocr, Qwen3-VL | GPU-hours ≈ $0.0085/page |

Two deliberate constraints worth knowing before you read the cost numbers:

- **Textract is called with `DetectDocumentText` only** ($0.0015/page). The far pricier
  `AnalyzeDocument` TABLES/FORMS paths are not used and not granted in IAM, so the
  Textract+LLM methods are rated on plain OCR plus an LLM — not on Textract's own
  table extraction.
- **Specialist OCR is off unless you configure an endpoint.** Each model needs its own
  GPU endpoint billed hourly *even when idle* (ml.g6e.2xlarge ≈ $2.24/hr), so all six
  would add roughly $10–30k/month. Left off, they stay visible in the catalog and
  report `sagemaker-endpoint-not-configured`. The `sagemaker:InvokeEndpoint` grant is
  scoped to the endpoints you actually configure.

## Environment variables

Full list in [`.env.example`](.env.example). Highlights:

| Var | Default | Notes |
| --- | --- | --- |
| `AWS_REGION` | `us-west-2` | |
| `S3_BUCKET` | *(empty)* | Required unless `USE_LOCAL_STORAGE=true` |
| `USE_LOCAL_STORAGE` | *(unset)* | `true` → uses `.local-uploads/` instead of S3 |
| `AUTH_PROVIDER` | `none` | `none` \| `cognito` |
| `ALLOW_UNAUTHENTICATED` | *(unset)* | Only with `AUTH_PROVIDER=none` + `NODE_ENV=production`. Otherwise boot is refused. |
| `ADMIN_USERS` | `''` | Comma-separated aliases. Ignored when `AUTH_PROVIDER=none` (unless `ALLOW_UNAUTHENTICATED=true`). |
| `DEV_USER_ALIAS` | `local-user` | Override local user alias when `AUTH_PROVIDER=none`. Set to match an `ADMIN_USERS` entry to test admin locally. |
| `CLOUDFRONT_SECRET` | *(unset)* | Shared secret for CloudFront → ALB origin validation. When set in production, requests without the matching `X-CloudFront-Secret` header are rejected. |
| `ACTIVITY_TABLE` | *(unset)* | DynamoDB table name for activity tracking + recent runs. |
| `COGNITO_USER_POOL_ID` | *(empty)* | Required when `AUTH_PROVIDER=cognito` |
| `COGNITO_CLIENT_ID` | *(empty)* | Optional allowlist, comma-separated |
| `BDA_PROFILE_ARN` / `BDA_PROJECT_ARN` | *(empty)* | Optional — BDA methods unavailable if unset |
| `CLAUDE_MODEL_ID` / `NOVA_MODEL_ID` | GA defaults | Override for regional variants |
| `VITE_APP_TITLE` | `ONE IDP Evaluation Framework` | Frontend top-nav title |
| `VITE_REPO_URL` / `VITE_CHAT_URL` | *(unset)* | Source / chat links. **Shown only in dev builds** by default (`import.meta.env.DEV`). Set `VITE_SHOW_LINKS=true` at build time to force-show in prod. |

## Deployment

Two equivalent IaC stacks. Pick one — do **not** run both against the same account/region.

| Stack | Path | Tooling |
| --- | --- | --- |
| Terraform | [`infrastructure/`](infrastructure/) | `>= 1.6` |
| CDK (TypeScript) | [`infrastructure-cdk/`](infrastructure-cdk/) | AWS CDK v2 |

Both produce the same 3-tier topology (see [docs/architecture.md](docs/architecture.md)):

- **Edge tier** — CloudFront + optional Route53 + ACM
- **Web tier** — ECS Fargate behind an ALB (Express API, pluggable auth, HPA on CPU &amp; RPS)
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
  -c authProvider=cognito \
  -c bdaProfileArn="arn:aws:bedrock:us-west-2:<account>:data-automation-profile/us.data-automation-v1"
```

See [`infrastructure/README.md`](infrastructure/README.md) and [`infrastructure-cdk/README.md`](infrastructure-cdk/README.md) for variable references and migration notes.

## Authentication

The backend ships with a pluggable `AUTH_PROVIDER`:

- **`none`** — demo mode; synthetic anonymous user.
  - Refuses to boot in `NODE_ENV=production` unless `ALLOW_UNAUTHENTICATED=true` is set explicitly.
  - Admin endpoints (`/api/admin/*`) are **always denied** when `AUTH_PROVIDER=none`, regardless of `ADMIN_USERS`.
- **`cognito`** — real JWT verifier using [`jose`](https://github.com/panva/jose). Fetches the user pool JWKS, verifies signature + issuer + expiry + `token_use`, and optionally checks `client_id` against `COGNITO_CLIENT_ID` allowlist. Accepts both ID and access tokens.

Switch providers without code changes via env vars alone. The dispatcher lives in [`packages/backend/src/middleware/auth.ts`](packages/backend/src/middleware/auth.ts).

## Security

### Hardening applied to this repo

- **Path-traversal defense** — `/api/files/*` rejects keys with `..`, leading `/`, or null bytes before touching the backend. `getLocalFilePath` additionally resolves absolute paths and verifies containment within `.local-uploads/`.
- **Filename sanitization** — uploaded filenames are NFC-normalized and stripped of path separators / control characters before being used as S3 keys.
- **Upload limits** — `multer` caps body size at 50MB and enforces a mimetype allowlist from `@idp/shared`.
- **Admin defense-in-depth** — admin middleware refuses access when auth is disabled (`AUTH_PROVIDER=none`), even if aliases match. Empty `ADMIN_USERS` also blocks all admins.
- **Fail-closed prod boot** — `NODE_ENV=production` + unauth provider → backend throws on startup unless `ALLOW_UNAUTHENTICATED=true` is explicitly set.
- **IAM least-privilege** — bucket-scoped S3 ARNs, agent-scoped AgentCore invoke ARNs. The few remaining `Resource: "*"` policies are standard Bedrock/Textract usage.
- **JWT verification** — Cognito path uses `jose.jwtVerify` against the live JWKS, not a homegrown parser.

### Known trust assumptions / TODOs

- Rate limiter is per-IP in-memory. With ECS auto-scaling, an attacker hitting N instances gets N× the rate limit. Use Redis or an edge WAF (CloudFront + AWS WAF rate-based rules) for production traffic.
- **CloudFront origin validation** — `cloudfront-secret.ts` middleware validates `X-CloudFront-Secret` header in production. Set `CLOUDFRONT_SECRET` env var on the ECS task to match the Terraform-managed `random_password.cloudfront_secret`. Health-check paths are exempt.
- `AUTH_PROVIDER=none` uses `DEV_USER_ALIAS` env var (default: `local-user`) instead of the OS username. This prevents accidental admin privilege escalation when the OS user matches an `ADMIN_USERS` entry.

## License

MIT-0. See [LICENSE](LICENSE).
