---
id: "insurance_claims"
name: "Insurance Claims"
description: "Extract claim details, policy info, damage assessment, and coverage information"
category: "industry_specific"
categoryName: "Industry-Specific"
icon: "shield"
defaultFormat: "json"
tags: ["insurance", "claim", "policy", "coverage", "damage", "assessment"]
exampleInput: "Auto insurance claim form"
exampleOutput: "{"claimId": "...", "policyNumber": "...", "damages": [...], "amount": "$..."}"
support:
  bda: "good"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
---

# Insurance Claims

Extract claim details, policy info, damage assessment, and coverage information

## When to use

Use this skill when the user needs to claim details, policy info, damage assessment, and coverage information.

## Example

**Input**: Auto insurance claim form

**Output**: {"claimId": "...", "policyNumber": "...", "damages": [...], "amount": "$..."}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
