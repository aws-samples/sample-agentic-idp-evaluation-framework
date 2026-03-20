---
id: "receipt_parsing"
name: "Receipt Parsing"
description: "Parse receipts for items, prices, totals, store info, and payment details"
category: "industry_specific"
categoryName: "Industry-Specific"
icon: "shopping-cart"
defaultFormat: "json"
tags: ["receipt", "items", "prices", "store", "expense", "reimbursement"]
exampleInput: "Restaurant receipt photo"
exampleOutput: "{"store": "...", "items": [...], "subtotal": "$45.00", "tip": "$9.00"}"
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "excellent"
---

# Receipt Parsing

Parse receipts for items, prices, totals, store info, and payment details

## When to use

Use this skill when the user needs to parse receipts for items, prices, totals, store info, and payment details.

## Example

**Input**: Restaurant receipt photo

**Output**: {"store": "...", "items": [...], "subtotal": "$45.00", "tip": "$9.00"}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: excellent
