---
id: "barcode_qr"
name: "Barcode & QR Code"
description: "Detect and decode barcodes, QR codes, and data matrix codes"
category: "visual_analysis"
categoryName: "Visual Analysis"
icon: "maximize"
defaultFormat: "json"
tags: ["barcode", "qr", "data-matrix", "scan", "code"]
support:
  bda: "limited"
  bda-llm: "limited"
  claude: "limited"
  nova: "good"
---

# Barcode & QR Code

Detect and decode barcodes, QR codes, and data matrix codes

## When to use

Use this skill when the user needs to and decode barcodes, qr codes, and data matrix codes.

## Example

**Input**: Shipping label with barcode

**Output**: {"type": "QR", "data": "https://...", "location": {...}}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: limited
- **bda-llm**: limited
- **claude**: limited
- **nova**: good
