---
id: "pii_redaction"
name: "PII Redaction"
description: "Automatically redact PII from extracted text and generate sanitized output"
category: "compliance_security"
categoryName: "Compliance & Security"
icon: "eye-off"
defaultFormat: "json"
tags: ["redact", "sanitize", "mask", "anonymize", "privacy"]
exampleInput: "Document with SSNs and addresses"
exampleOutput: "Same document with PII replaced by [REDACTED]"
support:
  bda-llm: "good"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
  guardrails: "excellent"
---

# PII Redaction

Automatically redact PII from extracted text and generate sanitized output

## When to use

Use this skill when the user needs to automatically redact pii from extracted text and generate sanitized output.

## Example

**Input**: Document with SSNs and addresses

**Output**: Same document with PII replaced by [REDACTED]

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda-llm**: good
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
- **guardrails**: excellent
