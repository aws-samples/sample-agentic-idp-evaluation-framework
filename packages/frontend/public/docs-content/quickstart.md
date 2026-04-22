---
title: Quickstart
description: Upload a document and run a benchmark in 5 minutes.
---

Five steps, five minutes. Pick a representative sample document and drive the full pipeline end-to-end.

## 1. Upload a document

- Supported formats: **PDF, PNG, JPG, JPEG, TIFF, GIF, WebP, DOCX, XLSX, PPTX** (hard 50 MB cap).
- For multi-page PDFs larger than 5 MB the backend routes Textract to the async API automatically.
- Non-ASCII filenames (Korean, CJK) are normalized with NFC on upload and NFD-fallback on read, so files like `04-tax-receipt-pii.pdf` or `세금계산서.pdf` both work.

The upload lands in S3 (`one-idp-uploads-dev` by default) or in `.local-uploads/` when running without AWS. You'll land on **Analyze & Preview** immediately.

## 2. Let the agent analyze and pick capabilities

The conversation page invokes a Strands agent running on **Bedrock AgentCore**. The agent does two things:

1. Looks at your document and describes what it sees.
2. Recommends which capabilities matter for your use case, with a relevance score per capability.

You can accept the recommendation, add or remove capabilities, or chat with the agent to refine.

## 3. Review the pipeline

Pipeline view renders the execution DAG — one node per capability, each pointing at a chosen method. You can override any assignment with `Re-Generate` or the chat input (e.g., "switch table extraction to BDA+Sonnet").

Hit **Execute** to run all selected methods in parallel. The UI streams progress via Server-Sent Events — you'll see per-method latency, token usage, and cost as they arrive.

## 4. Read the comparison

When all methods finish, you get:

- **Per-method metrics** — latency, cost, confidence, token usage.
- **Capability matrix** — which methods handled which capabilities, with a support rating.
- **Rank** — each method scored on speed, cost, confidence, and an overall weighted score.

## 5. Generate the project

Architecture & Code stage does two things:

1. Streams an **architecture recommendation** (text + Mermaid diagram + cost table at 1 k / 10 k / 100 k docs/month).
2. Generates a **10-file deployable project**: `process.py`, `requirements.txt`, `process.ts`, `package.json`, CDK stack (`lib/idp-stack.ts`, `lambda/processor.ts`, `bin/idp.ts`, `cdk.json`, `cdk/package.json`), and a `README.md`.

Click **Download All Code** — you get a single markdown file with path-hinted sections you can split into a real project tree, then `cd cdk && npm install && npx cdk deploy`.

## What to try next

- [Methods](/methods) — when to prefer BDA vs LLM-only vs the hybrids.
- [Pricing](/pricing) — what these numbers mean at 100 k documents/month.
- [Generated code](/codegen) — what each of the 10 files actually contains.
