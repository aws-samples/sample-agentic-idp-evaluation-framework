---
id: "contract_analysis"
name: "Contract Analysis"
description: "Extract clauses, key terms, obligations, deadlines, and party information"
category: "industry_specific"
categoryName: "Industry-Specific"
icon: "file-text"
defaultFormat: "json"
tags: ["contract", "clause", "terms", "obligations", "legal", "nda", "agreement"]
exampleInput: "SaaS subscription agreement"
exampleOutput: "{"parties": [...], "clauses": [...], "termDate": "...", "obligations": [...]}"
support:
  bda: "limited"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
---

# Contract Analysis

Extract clauses, key terms, obligations, deadlines, and party information

## When to use

Use this skill when the user needs to clauses, key terms, obligations, deadlines, and party information.

## Example

**Input**: SaaS subscription agreement

**Output**: {"parties": [...], "clauses": [...], "termDate": "...", "obligations": [...]}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: limited
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
