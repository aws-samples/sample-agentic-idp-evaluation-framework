# ONE IDP - Project Context

## Overview

IDP Evaluation Platform that helps AWS SAs and customers find the optimal document processing approach. Built for `idp.sanghwa.people.aws.dev`.

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
- Midway auth with `MIDWAY_DISABLED=true` bypass for local dev

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
| Nova 2 Lite | $0.30 | $2.50 |
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

## Collaboration Context (Raj + WWSO Team)

- Working with Raj Jayaraman (GenAI/ML Geo SSA) and Wrick's WWSO IDP team
- Combining: Sanghwa's BDA comparison demo + Wrick's FM evaluation framework
- Timeline: Internal webinar 4/7-8, External webinar ~4/21, Workshop ~5/5
- Monthly rotation: Sanghwa/Raj → Iman → Arwin → Shashi
