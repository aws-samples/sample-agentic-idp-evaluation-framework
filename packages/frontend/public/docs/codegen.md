---
title: Production-ready project output
description: The 10-file project produced at the end of the pipeline.
---

# Production-ready project output

At the Architecture & Code stage, the platform generates a **10-file deployable project** based on your actual benchmark results. This page tells you what each file is and what to expect.

## Why real files, not boilerplate

Earlier versions of ONE IDP emitted two generic snippets with BDA commented out and CDK that pointed at a `lambda/processor.ts` that didn't exist. The 2026-04-21 rewrite fixed that by:

1. Pasting **real adapter patterns** from `packages/backend/src/adapters/` directly into the LLM prompt as reference.
2. Producing both the CDK stack *and* the Lambda handler that stack points at.
3. Emitting a deterministic template as fallback — still real code, with BDA poll loops and Textract async pagination implemented.

## The 10 files

| Tab label | Purpose | Typical size |
|---|---|---|
| `README.md` | Overview, prerequisites, local usage, deploy, cleanup. | ~80 lines |
| `process.py` | Python entrypoint with adapter functions per family. | 250-450 lines |
| `requirements.txt` | `boto3`, `PyYAML`, `Pillow`. | 4 lines |
| `process.ts` | Node 20 / TypeScript / ESM entrypoint — same shape as Python. | 250-450 lines |
| `package.json` | `@aws-sdk/*`, `sharp`, `yaml`, `tsx`, `typescript`. | pinned versions |
| `cdk/lib/idp-stack.ts` | The real CDK stack — S3, DynamoDB, Lambda, Step Functions, API Gateway, least-privilege IAM per model. | 150-250 lines |
| `cdk/lambda/processor.ts` | Lambda handler the stack points at. APIGateway + S3 event both handled. Writes results to DynamoDB. | 120-200 lines |
| `cdk/bin/idp.ts` | CDK app entry. | <20 lines |
| `cdk/package.json` | `aws-cdk-lib`, `constructs`, `aws-cdk`, TypeScript toolchain. | pinned |
| `cdk/cdk.json` | CDK context + feature flags (matches CDK v2 ^2.170). | standard |
| `pipeline.json` | Machine-readable config of your method assignments. | JSON |

## What's in `process.py` / `process.ts`

Both files implement the same shape:

- **Top-level `METHOD_ASSIGNMENTS`** dict/record mapping `capability → method`.
- **`MODEL_IDS`** map of method → Bedrock model ID.
- **`PRICING`** map of method → `{ in, out, perPage }` — the exact numbers from your benchmark.
- **One function per family** used in your pipeline:
  - `run_direct_llm(method, doc_bytes, file_name, capabilities)` — Claude/Nova via Converse.
  - `run_bda(method, s3_uri, capabilities)` — BDA invoke + 5 s poll + metadata→`standard_output_path` fetch.
  - `run_bda_llm(method, s3_uri, capabilities)` — BDA phase 1 + structured JSON phase 2.
  - `run_textract_llm(method, doc_bytes, file_name, capabilities, s3_uri)` — sync vs. async, NextToken pagination, LLM structuring.
- **`process_document(doc_bytes, file_name, s3_uri=None)`** — dispatcher that groups capabilities by method and runs each family exactly once.
- **CLI entry** — `python process.py sample.pdf` or `python process.py sample.pdf s3://bucket/key` for BDA.

The generator emits only the functions actually needed — if your benchmark didn't pick any BDA method, no BDA code appears in the output.

## What's in `cdk/lib/idp-stack.ts`

A real stack you can `cdk deploy` with no edits:

- **`inputBucket`** + **`outputBucket`** — versioned, SSE-S3, BlockPublicAccess `BLOCK_ALL`, `enforceSSL`, lifecycle rule to expire noncurrent versions at 90 days, `eventBridgeEnabled` on the input bucket.
- **`resultsTable`** (DynamoDB) — PK `documentId`, SK `methodId`, PAY_PER_REQUEST, point-in-time recovery, `RETAIN` removal policy.
- **`processorFn`** (`NodejsFunction`) — Node 20, 2 GB memory, 10-minute timeout, 2 GB ephemeral storage, X-Ray tracing, one-month log retention, `entry: '../lambda/processor.ts'` (which is the file we also emit).
- **Bedrock IAM** — `InvokeModel` and `InvokeModelWithResponseStream` on the **specific foundation-model ARNs** + inference-profile ARNs for each model ID in use. Not `*`.
- **BDA IAM** — added only if a BDA family is used. Scoped to the public-default data-automation-project plus the account's own projects.
- **Textract IAM** — added only if a Textract family is used. `*` resource because Textract doesn't support resource-level permissions for these actions.
- **`IngestStateMachine`** — Express Step Functions state machine that invokes `processorFn` and writes logs to a dedicated LogGroup.
- **API Gateway `IdpApi`** — REST, CORS `ALL_METHODS`, X-Ray tracing, CloudWatch logging, `RequestValidator` on the body.
- **`CfnOutput`s** — `InputBucketName`, `OutputBucketName`, `ResultsTableName`, `ApiEndpoint`, `StateMachineArn`.

## What's in `cdk/lambda/processor.ts`

The Lambda handler is a union-typed function that works for both:

- **APIGateway v2 events** — reads body (base64 or JSON with `s3Key` or `bodyBase64`), dispatches, writes results to DynamoDB, returns `{ documentId, result }` in a `200`.
- **S3 events** — iterates `event.Records`, fetches each object, dispatches, writes per-method results to DynamoDB.

It **imports** (not inlines) the adapter functions from `../process.js`, so the CLI and Lambda paths share code. There's no "TODO: implement me" anywhere.

## Deploying the generated project

Unpack the `Download All Code` markdown into the suggested tree:

```
idp-project/
├── README.md
├── process.py
├── requirements.txt
├── process.ts
├── package.json
└── cdk/
    ├── cdk.json
    ├── package.json
    ├── bin/idp.ts
    ├── lib/idp-stack.ts
    └── lambda/processor.ts
```

Then:

```bash
# Local CLI (Python)
pip install -r requirements.txt
python process.py sample.pdf                           # direct-LLM methods only
python process.py sample.pdf s3://bucket/sample.pdf    # for BDA too

# Local CLI (TypeScript)
npm install
npx tsx process.ts sample.pdf
npx tsx process.ts sample.pdf s3://bucket/sample.pdf

# Deploy to AWS
cd cdk
npm install
npx cdk bootstrap         # first time per account/region
npx cdk deploy

# Invoke
curl -X POST "$API_ENDPOINT/process" \
  -H 'content-type: application/json' \
  -d '{"fileName":"sample.pdf","s3Key":"uploads/sample.pdf"}'
```

## AI vs. template fallback

When Bedrock is reachable and the code-gen endpoint succeeds, the tab labels show `(AI)` — the project is generated fresh from your benchmark. When it's unavailable (quota, timeout, Bedrock outage), the deterministic template generator in `packages/frontend/src/pages/architectureTemplates.ts` fills in the same structure with the same shape of code. Both are runnable.

## Known caveats

- The generated stack uses `RemovalPolicy.RETAIN` on buckets and the table. `cdk destroy` will leave them behind — delete manually for a clean slate.
- Bedrock model ARNs are pinned to `us.*` inference-profile ARNs when the method uses one (Claude/Nova on Bedrock). For non-US regions, edit the stack to use the regional model ARN.
- The Lambda handler expects the zip you deploy has `process.ts` bundled adjacent to `lambda/processor.ts`. If you reorganize, adjust the `import { processDocument } from '../process.js'` path.
