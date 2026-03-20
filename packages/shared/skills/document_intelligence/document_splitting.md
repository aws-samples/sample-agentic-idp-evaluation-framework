---
id: "document_splitting"
name: "Document Splitting"
description: "Split multi-document PDFs into logical documents with page-level classification"
category: "document_intelligence"
categoryName: "Document Intelligence"
icon: "scissors"
defaultFormat: "json"
tags: ["split", "multi-document", "page-classification", "boundaries"]
exampleInput: "50-page PDF with mixed documents"
exampleOutput: "[{"pages": [1,2], "type": "invoice"}, {"pages": [3,4,5], "type": "contract"}]"
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "good"
  nova: "good"
  textract-llm: "good"
---

# Document Splitting

Split multi-document PDFs into logical documents with page-level classification

## When to use

Use this skill when the user needs to split multi-document pdfs into logical documents with page-level classification.

## Example

**Input**: 50-page PDF with mixed documents

**Output**: [{"pages": [1,2], "type": "invoice"}, {"pages": [3,4,5], "type": "contract"}]

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: good
- **nova**: good
- **textract-llm**: good
