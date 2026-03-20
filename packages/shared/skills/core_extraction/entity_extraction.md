---
id: "entity_extraction"
name: "Named Entity Extraction"
description: "Extract names, dates, monetary amounts, addresses, phone numbers, and emails"
category: "core_extraction"
categoryName: "Core Extraction"
icon: "user"
defaultFormat: "json"
tags: ["ner", "names", "dates", "amounts", "addresses", "phone", "email"]
exampleInput: "Business letter or contract"
exampleOutput: "{"persons": [...], "dates": [...], "amounts": [...], "addresses": [...]}"
support:
  bda: "good"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
---

# Named Entity Extraction

Extract names, dates, monetary amounts, addresses, phone numbers, and emails

## When to use

Use this skill when the user needs to names, dates, monetary amounts, addresses, phone numbers, and emails.

## Example

**Input**: Business letter or contract

**Output**: {"persons": [...], "dates": [...], "amounts": [...], "addresses": [...]}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
