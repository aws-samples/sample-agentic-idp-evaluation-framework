---
id: "language_detection"
name: "Language Detection"
description: "Auto-detect document language and optionally translate content"
category: "document_intelligence"
categoryName: "Document Intelligence"
icon: "globe"
defaultFormat: "json"
tags: ["language", "detect", "translate", "multilingual", "i18n"]
exampleInput: "Document in unknown language"
exampleOutput: "{"language": "ko", "confidence": 0.98, "name": "Korean"}"
support:
  bda: "good"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
---

# Language Detection

Auto-detect document language and optionally translate content

## When to use

Use this skill when the user needs to detect document language and optionally translate content.

## Example

**Input**: Document in unknown language

**Output**: {"language": "ko", "confidence": 0.98, "name": "Korean"}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
