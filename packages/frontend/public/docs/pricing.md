---
title: Pricing & cost model
description: How ONE IDP calculates cost and what to expect at scale.
---

# Pricing & cost model

Every method reports actual cost on every run, computed from real AWS prices and the real tokens that came back from the API. There's no fake-math — the formulas below are the ones the platform uses.

## The formula

For an LLM-based method:

```
cost = (inputTokens  / 1_000_000) × inputPer1MTokens
     + (outputTokens / 1_000_000) × outputPer1MTokens
     + perPageCost × pages
```

For a BDA standalone method:

```
cost = perPageCost × pages
```

For a 2-phase method (`bda-*` or `textract-*`):

```
cost = perPageCost(phase 1)  ×  pages
     + (llmInputTokens  / 1_000_000) × llmInputPer1MTokens
     + (llmOutputTokens / 1_000_000) × llmOutputPer1MTokens
```

The constants come from `packages/shared/src/types/processing.ts:METHOD_INFO[...].tokenPricing` and `estimatedCostPerPage`.

## Amazon Bedrock model pricing

| Model | Input $/1M | Output $/1M |
|---|---|---|
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| Claude Haiku 4.5 | $1.00 | $5.00 |
| Claude Opus 4.6 | $5.00 | $25.00 |
| Nova 2 Lite | $0.30 | $2.50 |
| Nova 2 Pro (Preview) | $1.25 | $10.00 |
| Nova Multimodal Embeddings | $0.135 | — |

Nova 2 Lite charges a fixed **230 tokens/image** (resolution-independent) since 2026-03-30.

## Per-page service pricing

| Service | $/page |
|---|---|
| BDA Standard | $0.010 |
| BDA Custom | $0.040 |
| Amazon Textract (OCR) | $0.0015 |

## Cost projection at scale

The generated architecture recommendation includes a projection at three scales. Rough order of magnitude for a typical 5-page English form, running **one method**:

| Docs/month | BDA Std | Claude Haiku | Claude Sonnet | Nova Lite | Textract+Haiku |
|---:|---:|---:|---:|---:|---:|
| 1,000 | $50 | $20 | $75 | $5 | $30 |
| 10,000 | $500 | $200 | $750 | $50 | $300 |
| 100,000 | $5,000 | $2,000 | $7,500 | $500 | $3,000 |

Actual numbers vary with document size and output complexity. The **preview** run inside the app is the authoritative source: it gives you the cost for *your actual document* rather than a generic estimate.

## What the Cost Projection calculator does

On the Architecture page there's a **Cost Projection** block where you enter `docs/month` and `avgPages/doc`. It multiplies each method's measured per-page cost by your volume and shows monthly + annual totals.

This uses the **measured** cost from your preview, not an average. If your preview ran 2,460 input tokens for the Korean PDF in the E2E tests, the calculator projects from that.

## AWS service costs not shown

ONE IDP only shows *extraction cost*. You'll also pay for:

- **S3 storage** — documents + BDA outputs. Pennies per GB per month.
- **DynamoDB** — activity tracking + results. PAY_PER_REQUEST, typically < $1/month at small scale.
- **App Runner** — the backend container. Fixed at ~$50/month at minimum spec when idle.
- **CloudFront + Route 53** — edge delivery of the SPA. ~$1/month at small traffic.
- **Bedrock AgentCore Runtime** — billed per invocation like Lambda.

These are line items in your AWS bill, not shown inside ONE IDP.

## A note on confidence

Confidence scores are **self-reported by the model** ("how sure are you?"). They correlate weakly with actual accuracy. When picking between two methods:

1. Cost and latency are real.
2. Confidence is a tiebreaker, not a measure of correctness.
3. Smart pipeline routing picks the cheaper option when confidence is within 5%.
