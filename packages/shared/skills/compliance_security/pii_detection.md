---
id: "pii_detection"
name: "PII Detection"
description: "Detect personally identifiable information: SSN, credit cards, bank accounts, etc."
category: "compliance_security"
categoryName: "Compliance & Security"
icon: "shield"
defaultFormat: "json"
tags: ["pii", "ssn", "credit-card", "bank-account", "privacy", "gdpr"]
exampleInput: "Customer application form"
exampleOutput: "[{"type": "SSN", "value": "***-**-1234", "location": {...}}]"
support:
  bda: "limited"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
  guardrails: "excellent"
---

# PII Detection

Detect personally identifiable information: SSN, credit cards, bank accounts, etc.

## When to use

Use this skill when the user needs to personally identifiable information: ssn, credit cards, bank accounts, etc..

## Example

**Input**: Customer application form

**Output**: [{"type": "SSN", "value": "***-**-1234", "location": {...}}]

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: limited
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
- **guardrails**: excellent
