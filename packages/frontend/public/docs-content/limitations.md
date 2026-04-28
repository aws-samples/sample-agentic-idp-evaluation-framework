---
title: Limitations & FAQ
description: Known constraints, language support, and gated-preview models.
---

## Language support

**BDA and Textract produce garbled output for non-English documents.** The platform detects this and filters methods accordingly.

The rule (`isMethodLanguageCompatible` in `packages/shared/src/types/processing.ts`):

| Primary language | All languages English? | BDA/BDA+LLM/Textract+LLM |
|---|---|---|
| English (starts with `en`) | — | Allowed |
| non-English | — | **Excluded** |
| — | Yes | Allowed |

If your document is primarily Korean, Japanese, Arabic, or any non-Latin script, the comparison will show only Claude and Nova methods. This is not a limitation of the platform — it's a limitation of BDA and Textract on those scripts.

## Gated-preview models

**Nova 2 Pro** (`us.amazon.nova-2-pro-preview-20251202-v1:0`) is a **Gated Preview**:

- No GA SLA.
- Limited regional availability.
- 100 RPM (requests per minute) quota.
- May be rate-limited or temporarily unavailable.

Nova 2 Lite is **GA** and is the default Nova choice. Prefer it unless you specifically need Nova Pro's native bounding-box support or its structural-reasoning bump.

## Regional constraints

- **Nova Multimodal Embeddings** live in **us-east-1 only** at the moment. If your stack is in `us-west-2`, the `nova-embeddings` method makes a cross-region call.
- BDA is available in a subset of commercial regions — check the Bedrock docs.
- AgentCore is generally available in the same regions as Bedrock.

## Upload size

- Hard cap: **50 MB** per file (enforced by multer in the backend).
- Textract sync API breaks above 5 MB for PDFs — the `TwoPhaseAdapter` automatically switches to the async API (`StartDocumentAnalysis` + `NextToken` pagination) when your PDF exceeds 5 MB or has more than one page.
- Claude/Nova `Converse` with PDF bytes has a practical limit around 4.5 MB per image block — images over that are auto-resized with `sharp` (or Pillow in the generated Python code).

## Context windows

| Model | Context |
|---|---|
| Claude Sonnet 4.6 | 1 M tokens |
| Claude Opus 4.6 | 1 M tokens |
| Claude Haiku 4.5 | 200 K tokens |
| Nova 2 Lite | large (per Nova docs) |
| Nova 2 Pro | large (per Nova docs) |
| Nova Multimodal Embeddings | 8 K tokens per text segment |

For very long documents, Haiku's smaller window can cause truncation. The `calculateMaxTokens()` helper bumps output tokens to `1000/cap + 800/page (min 4096, max 16384)` to give models enough room to finish tables in HTML, which tends to be the common truncation mode for CJK tables.

## Confidence scores

**Self-reported, not verified.** Every adapter asks the model to include a `confidence` field per capability, and we display it as-is. A model saying `confidence: 0.95` does not mean 95% accuracy — it means 95% self-belief. When two methods score within 5%, the smart pipeline chooses the cheaper one; don't use absolute confidence as the primary signal.

## Auth quirks

- `AUTH_PROVIDER=none` blocks admin endpoints **always**, even if you add your alias to `ADMIN_USERS`.
- For CLI testing with `AUTH_PROVIDER=cognito`, obtain a valid Cognito JWT and pass it as `Authorization: Bearer <token>`.

## Rate limiting

- Per-IP in-memory with per-user override (when authenticated).
- Resets when the App Runner container restarts.
- For multi-instance or multi-region deployments, swap in Redis or AWS WAF — the middleware is a straight drop-in.

## Deployment quirks

- **Don't run Terraform and CDK against the same account+region.** They provision the same resources and will fight over state.
- **`manage_activity_table` defaults to `false`** in Terraform so existing deployments don't destroy their DynamoDB table on apply. Set to `true` for a fresh install.
- Frontend deploys are separate from backend — `npm run build -w packages/frontend` → `aws s3 sync` → CloudFront invalidation.
- Backend deploys go through CodeBuild: `git archive HEAD` → S3 → CodeBuild → ECR → `aws apprunner start-deployment`.

## FAQ

### Can I use it without AWS credentials?

Partially. Upload, conversation (in-process fallback), and any LLM adapter still need Bedrock credentials. If you have no AWS setup, you can run the frontend and browse the docs, but methods won't execute.

### Can I add a new capability?

Yes — create a markdown file under `packages/shared/skills/<category>/<id>.md` with the standard frontmatter + support matrix, run `npm run build:skills -w packages/shared`, and rebuild. See [Capabilities](/capabilities).

### Can I add a new method?

Yes — add an entry to `METHODS` and `METHOD_INFO` in `packages/shared/src/types/processing.ts`, then register a processor in the backend's `processor-registry.ts`. The adapter implementation goes in `packages/backend/src/adapters/`.

### Does this use my document to train a model?

No. `ConverseCommand`, `InvokeDataAutomationAsync`, and Textract calls don't train on your data. Standard Bedrock data retention applies (24 h abuse-monitoring window unless you've opted out at the org level).

### What's the difference between Terraform and CDK paths?

They provision the same topology. Terraform is the reference live deployment. CDK exists for customers who prefer TypeScript-native IaC. **Pick one.** They'll clobber each other's state if you run both against the same environment.

### How do I contribute?

Issues and PRs welcome. The repository is an AWS Sample — the guidelines and license live in `LICENSE` and `CONTRIBUTING.md` at the repo root.
