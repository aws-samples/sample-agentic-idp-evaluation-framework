---
id: "text_extraction"
name: "Text Extraction"
description: "Extract printed text from any document with layout preservation"
category: "core_extraction"
categoryName: "Core Extraction"
icon: "file-text"
defaultFormat: "text"
tags: ["text", "ocr", "printed", "digital"]
exampleInput: "Scanned contract PDF"
exampleOutput: "Full text with paragraph structure"
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "excellent"
---

# Text Extraction

Extract printed text from any document with layout preservation

## When to use

Use this skill when the user needs to printed text from any document with layout preservation.

## Example

**Input**: Scanned contract PDF

**Output**: Full text with paragraph structure

## Output format

Default format: `text`

Returns plain text with preserved structure and formatting.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: excellent
