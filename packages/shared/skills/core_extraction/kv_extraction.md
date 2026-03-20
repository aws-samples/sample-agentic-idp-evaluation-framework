---
id: "kv_extraction"
name: "Key-Value Pair Extraction"
description: "Extract structured key-value pairs from forms, labels, and field-based documents"
category: "core_extraction"
categoryName: "Core Extraction"
icon: "list"
defaultFormat: "json"
tags: ["form", "fields", "key-value", "structured", "labels"]
exampleInput: "Tax form W-2"
exampleOutput: "{"employer_name": "...", "wages": "$...", "ssn": "***-**-****"}"
support:
  bda: "good"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "excellent"
---

# Key-Value Pair Extraction

Extract structured key-value pairs from forms, labels, and field-based documents

## When to use

Use this skill when the user needs to structured key-value pairs from forms, labels, and field-based documents.

## Example

**Input**: Tax form W-2

**Output**: {"employer_name": "...", "wages": "$...", "ssn": "***-**-****"}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: excellent
