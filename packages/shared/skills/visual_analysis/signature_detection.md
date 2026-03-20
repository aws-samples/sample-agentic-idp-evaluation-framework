---
id: "signature_detection"
name: "Signature Detection"
description: "Detect presence and location of signatures, initials, and stamps"
category: "visual_analysis"
categoryName: "Visual Analysis"
icon: "pen-tool"
defaultFormat: "json"
tags: ["signature", "initials", "stamp", "signed", "notarized"]
support:
  bda: "limited"
  bda-llm: "good"
  claude: "good"
  nova: "good"
  textract-llm: "good"
---

# Signature Detection

Detect presence and location of signatures, initials, and stamps

## When to use

Use this skill when the user needs to presence and location of signatures, initials, and stamps.

## Example

**Input**: Signed contract

**Output**: {"hasSignature": true, "locations": [...], "count": 2}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: limited
- **bda-llm**: good
- **claude**: good
- **nova**: good
- **textract-llm**: good
