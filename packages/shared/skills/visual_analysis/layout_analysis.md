---
id: "layout_analysis"
name: "Layout Analysis"
description: "Detect reading order, columns, sections, headers, footers, and page structure"
category: "visual_analysis"
categoryName: "Visual Analysis"
icon: "layout"
defaultFormat: "json"
tags: ["layout", "columns", "sections", "headers", "footers", "reading-order"]
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "good"
  nova: "excellent"
  textract-llm: "excellent"
---

# Layout Analysis

Detect reading order, columns, sections, headers, footers, and page structure

## When to use

Use this skill when the user needs to reading order, columns, sections, headers, footers, and page structure.

## Example

**Input**: Multi-column newspaper article

**Output**: {"sections": [...], "readingOrder": [...], "columns": 2}

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: good
- **nova**: excellent
- **textract-llm**: excellent
