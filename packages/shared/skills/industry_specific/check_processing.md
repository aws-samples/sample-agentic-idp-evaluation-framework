---
id: "check_processing"
name: "Check Processing"
description: "Extract courtesy/legal amounts, payee, date, memo, and MICR line from checks"
category: "industry_specific"
categoryName: "Industry-Specific"
icon: "credit-card"
defaultFormat: "json"
tags: ["check", "cheque", "amount", "payee", "micr", "banking"]
exampleInput: "Personal check image"
exampleOutput: "{"courtesyAmount": "$500.00", "legalAmount": "Five hundred...", "payee": "..."}"
support:
  bda: "good"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "excellent"
---

# Check Processing

Extract courtesy/legal amounts, payee, date, memo, and MICR line from checks

## When to use

Use this skill when the user needs to courtesy/legal amounts, payee, date, memo, and micr line from checks.

## Example

**Input**: Personal check image

**Output**: {"courtesyAmount": "$500.00", "legalAmount": "Five hundred...", "payee": "..."}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: excellent
