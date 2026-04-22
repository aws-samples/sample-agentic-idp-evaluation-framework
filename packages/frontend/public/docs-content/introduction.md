---
title: Introduction
description: What ONE IDP is and who it's for.
---

**ONE IDP** is an evaluation platform for Intelligent Document Processing on AWS. Upload a sample document, tell it what you want to extract, and it runs the major processing methods side-by-side against your actual document — then hands you a deployable project.

It's aimed at **AWS Solutions Architects and customers** who need to answer one question: *"which AWS document processing approach best fits my use case, and what does it cost?"*

## What you get

Instead of running a dozen proofs-of-concept by hand, you get:

- A single upload evaluated against up to **15 processing methods** (Bedrock Data Automation, Claude, Nova, and Amazon Textract in hybrid configurations).
- Real measurements: latency, token usage, cost, and self-reported confidence per method per capability.
- A side-by-side **comparison dashboard** ranked by speed, cost, confidence, and overall score.
- An **AI-generated architecture recommendation** with a Mermaid diagram and cost projections at three scales.
- A **10-file production project** — Python, TypeScript, and a deployable CDK stack — that you can drop into a repo and `cdk deploy`.

## What ONE IDP is *not*

- It is **not** a production inference service. It's an evaluation harness.
- It is **not** a blueprint editor for BDA custom blueprints (that work happens in the Bedrock console).
- It does not claim confidence scores are ground truth — models grade their own homework. Treat confidence as a *tiebreaker* after cost and latency, not as absolute accuracy.

## How it's different from running adapters yourself

The five moving parts — BDA async poll, Textract sync/async, LLM `Converse` with PDF bytes, two-phase BDA→LLM and Textract→LLM — are all implemented as adapters in `packages/backend/src/adapters/`. ONE IDP runs them in parallel, collects actual token usage from each, and the code generator emits code that **mirrors those same adapter shapes** rather than hallucinated boilerplate.

If you skip the platform and build the adapters yourself, you end up writing roughly the same code. ONE IDP's value is that it *benchmarks your document against all of them first* so you know which one to actually ship.

## Where to go next

- [Quickstart](/quickstart) — upload a document and run the benchmark.
- [The 5-step workflow](/workflow) — what each step does.
- [Methods](/methods) — the 15 processing methods and when to pick each.
