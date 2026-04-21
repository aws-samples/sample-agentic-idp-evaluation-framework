# ONE IDP - Project Context

## Overview

IDP Evaluation Platform that helps AWS SAs and customers find the optimal document processing approach. Deployable to any custom domain; see `infrastructure/README.md`.

## Architecture Decisions

### Deep Interview Spec (2026-03-17)
- **Goal**: Upload → Question Flow → Capability Routing → Parallel Processing → Comparison Dashboard → Architecture Recommendation
- **Ambiguity Score**: 18.2% (passed 20% threshold)
- Full spec at `.omc/specs/deep-interview-idp-platform.md`

### RALPLAN Consensus (Architect + Critic APPROVED)
- **Monolithic backend** with embedded Strands agents (fastest path to demo)
- **SSE streaming** for all AI endpoints with 15s keepalive
- **StreamAdapter pattern**: SyncPollAdapter (BDA), TokenStreamAdapter (Claude/Nova), TwoPhaseAdapter (Textract+LLM)
- **Single BDA invocation** for both Standard + Custom outputs
- Full plan at `.omc/plans/idp-unified-platform.md`

### Key Technical Decisions
- `costPerPage` renamed to `estimatedCostPerPage` — actual pricing is per-token
- `tokenPricing` (inputPer1MTokens, outputPer1MTokens) added for honest pricing display
- Nova 2 Pro is **Gated Preview** (no GA SLA), Nova 2 Lite is **GA** default
- Claude models updated to latest: Sonnet 4.6, Opus 4.6, Haiku 4.5
- **Pluggable auth** (2026-04-21): `AUTH_PROVIDER=midway|cognito|none`. Terraform default is `midway` (live back-compat); backend default is `none` (demo). Production boot with `AUTH_PROVIDER=none` is refused unless `ALLOW_UNAUTHENTICATED=true`. Admin endpoints always deny under `AUTH_PROVIDER=none`.
- **Cognito JWT** verifier uses `jose` v6 against live JWKS, validates issuer/expiry/token_use/client_id.
- **IaC parity**: Terraform (`infrastructure/`) and CDK TypeScript (`infrastructure-cdk/`) both ship. CDK uses official `aws-cdk-lib/aws-bedrockagentcore.CfnRuntime`. Do NOT run both stacks against the same account/region.
- **TopNav external links** (GitLab / Slack) are shown only when `import.meta.env.DEV` is true (local `npm run dev`), unless `VITE_SHOW_LINKS=true` is set at build time.

## Conventions

- **TypeScript** throughout (shared types ensure frontend/backend consistency)
- **npm workspaces**: `packages/shared`, `packages/backend`, `packages/frontend`
- Build order: `shared` → `backend` + `frontend` (parallel)
- All AWS service calls in `adapters/` (not processors — processors are config holders that delegate to adapters)
- SSE endpoints: POST-based with `useSSE` hook (not native EventSource)
- Cloudscape Design Components only (no third-party UI libraries, no Recharts)
- Lucide React icons for consistent iconography
- Colors: neutral by default, blue (#0972d3) for emphasis only

## Models (as of 2026-03-17)

### Current (Bedrock IDs)
- Claude Sonnet 4.6: `us.anthropic.claude-sonnet-4-6`
- Claude Haiku 4.5: `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- Claude Opus 4.6: `us.anthropic.claude-opus-4-6-v1`
- Nova 2 Lite (GA): `us.amazon.nova-2-lite-v1:0`
- Nova 2 Pro (Preview): `us.amazon.nova-2-pro-preview-20251202-v1:0`
- Nova Multimodal Embeddings: `amazon.nova-2-multimodal-embeddings-v1:0`

### Pricing (Standard Tier, US regions)
| Model | Input/1M tokens | Output/1M tokens |
|-------|----------------|-----------------|
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| Claude Haiku 4.5 | $1.00 | $5.00 |
| Claude Opus 4.6 | $5.00 | $25.00 |
| Nova 2 Lite | $0.30 (fixed 230 tokens/image since 3/30) | $2.50 |
| Nova 2 Pro | $1.25 | $10.00 |
| BDA Standard | $0.01/page | — |
| BDA Custom | $0.04/page | — |
| Textract | $0.0015/page | — |
| Nova Embeddings | $0.018 | — |

## 30 Capabilities (7 Categories)

1. **Core Extraction** (5): Text, Handwriting, Table, Key-Value, Entity
2. **Visual Analysis** (5): Image/Chart, Bounding Box, Signature, Barcode/QR, Layout
3. **Document Intelligence** (4): Classification, Splitting, Summarization, Language Detection
4. **Compliance & Security** (2): PII Detection, PII Redaction
5. **Industry-Specific** (6): Invoice, Receipt, Check, Insurance Claims, Medical Records, Contract
6. **Media Processing** (5): Video Summarization, Video Chapter Extraction, Audio Transcription, Audio Summarization, Content Moderation
7. **Advanced AI** (3): Image Separation, Embedding Generation, Knowledge Base Ingestion

<!-- Internal collaboration / rotation notes removed from public repo.
     Owners: track schedules in your own team doc / ticket system. -->

## Security hardening (2026-04-21)

- `/api/files/*` proxy rejects traversal (`..`, leading `/`, null bytes) before hitting local FS or S3.
- `getLocalFilePath` resolves absolute path and verifies containment under `.local-uploads/`.
- `uploadDocument` strips path separators + control chars from user filename via `basename(...).replace(/[\u0000-\u001f/\\]/g, '_')`.
- `requireAdmin` middleware denies when `AUTH_PROVIDER=none` OR `adminUsers` is empty, independent of alias match.
- `assertSafeAuthConfig()` runs at startup — throws if `NODE_ENV=production` + (unauth) without `ALLOW_UNAUTHENTICATED=true`.
- Multer: 50MB hard limit, mimetype allowlist from `@idp/shared`.
- `midway.ts` has inline comment documenting the `x-midway-user` trust boundary — safe only behind a Midway-terminating edge that strips inbound headers.

## E2E verification (2026-04-21)

Verified locally against live AWS (account 123456789012):
- Upload Korean PDF (04-tax-receipt-pii.pdf) → documentId + local:// URI
- File proxy serves 116530 bytes
- `POST /api/preview` with `claude-haiku` → SSE stream: `preview_start` → `method_result` (Korean text extraction, 0.95 confidence, 2460/1866 tokens, $0.0118, 18.7s) → `preview_done`
- Terraform plan against live state: **0 adds / 2 safe in-place / 0 destroys** (ACTIVITY_TABLE env add + provider-level SSE cosmetic)
- `cdk synth` clean, no warnings after `pointInTimeRecoverySpecification` migration.
- Traversal vectors (`..`, absolute, null byte) all 404.
- Admin endpoint with `AUTH_PROVIDER=none` → 403 with clear message.

## IaC layout

- `infrastructure/` — Terraform. Default backend `one-idp-terraform-state` for existing deployment. Public deployers override via `-backend-config`. DynamoDB activity table guarded by `manage_activity_table` (default false; true for fresh installs).
- `infrastructure-cdk/` — CDK v2 TypeScript. Tiers split into `lib/{storage,ecr,agent-runtime,app-runner,edge,activity-table}.ts`. `bedrockagentcore.CfnRuntime` used directly. `RuntimeEndpoint` intentionally NOT added (DEFAULT-only per design).

