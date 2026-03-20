---
id: "document_classification"
name: "Document Classification"
description: "Automatically classify document type (invoice, contract, form, letter, etc.)"
category: "document_intelligence"
categoryName: "Document Intelligence"
icon: "folder"
defaultFormat: "json"
tags: ["classify", "categorize", "type", "identification"]
support:
  bda: "good"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
---

# Document Classification

Automatically classify document type (invoice, contract, form, letter, etc.)

## When to use

Use this skill when the user needs to automatically classify document type (invoice, contract, form, letter, etc.).

## Example

**Input**: Unknown document

**Output**: {"type": "invoice", "confidence": 0.95, "subtype": "utility_bill"}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
