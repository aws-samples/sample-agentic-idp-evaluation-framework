---
id: "invoice_processing"
name: "Invoice Processing"
description: "Extract line items, totals, taxes, discounts, vendor/buyer info from invoices"
category: "industry_specific"
categoryName: "Industry-Specific"
icon: "file-text"
defaultFormat: "json"
tags: ["invoice", "line-items", "totals", "vendor", "ap", "accounts-payable"]
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "excellent"
---

# Invoice Processing

Extract line items, totals, taxes, discounts, vendor/buyer info from invoices

## When to use

Use this skill when the user needs to line items, totals, taxes, discounts, vendor/buyer info from invoices.

## Example

**Input**: Vendor invoice PDF

**Output**: {"vendor": "...", "lineItems": [...], "total": "$1,234.56", "tax": "$98.76"}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: excellent
