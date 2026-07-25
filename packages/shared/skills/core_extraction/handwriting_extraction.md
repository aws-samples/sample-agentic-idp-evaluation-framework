---
id: "handwriting_extraction"
name: "Handwriting Recognition"
description: "Recognize and extract handwritten text, notes, and annotations"
category: "core_extraction"
categoryName: "Core Extraction"
icon: "edit"
defaultFormat: "text"
tags: ["handwriting", "cursive", "annotations", "notes"]
exampleInput: "Handwritten medical form"
exampleOutput: "Digitized text from handwritten fields"
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "excellent"
  gpt: "excellent"
  nova: "good"
  textract-llm: "excellent"
  sagemaker-ocr: "good"
---

# Handwriting Recognition

Recognize and extract handwritten text, notes, and annotations

## When to use

Use this skill when the user needs to and extract handwritten text, notes, and annotations.

## Example

**Input**: Handwritten medical form

**Output**: Digitized text from handwritten fields

## Output format

Default format: `text`

Returns plain text with preserved structure and formatting.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: excellent
- **sagemaker-ocr**: good
