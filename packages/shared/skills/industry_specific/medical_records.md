---
id: "medical_records"
name: "Medical Records"
description: "Extract patient info, diagnoses (ICD codes), medications, and treatment plans"
category: "industry_specific"
categoryName: "Industry-Specific"
icon: "activity"
defaultFormat: "json"
tags: ["medical", "health", "patient", "diagnosis", "icd", "medication", "hipaa"]
exampleInput: "Patient discharge summary"
exampleOutput: "{"patient": "...", "diagnoses": [...], "medications": [...]}"
support:
  bda: "good"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "good"
---

# Medical Records

Extract patient info, diagnoses (ICD codes), medications, and treatment plans

## When to use

Use this skill when the user needs to patient info, diagnoses (icd codes), medications, and treatment plans.

## Example

**Input**: Patient discharge summary

**Output**: {"patient": "...", "diagnoses": [...], "medications": [...]}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: good
