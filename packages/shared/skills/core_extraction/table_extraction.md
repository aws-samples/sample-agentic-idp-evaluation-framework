---
id: "table_extraction"
name: "Table Extraction"
description: "Extract tables including nested, merged cells, and complex layouts to HTML or CSV"
category: "core_extraction"
categoryName: "Core Extraction"
icon: "table"
defaultFormat: "html"
tags: ["table", "nested", "merged", "html", "csv", "structured"]
exampleInput: "Financial statement with nested tables"
exampleOutput: "HTML/CSV with preserved structure"
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "excellent"
  nova: "good"
  textract-llm: "excellent"
---

# Table Extraction

Extract tables including nested, merged cells, and complex layouts to HTML or CSV

## When to use

Use this skill when the user needs to tables including nested, merged cells, and complex layouts to html or csv.

## Example

**Input**: Financial statement with nested tables

**Output**: HTML/CSV with preserved structure

## Output format

Default format: `html`

Returns structured HTML (e.g., `<table>` elements with `<thead>` and `<tbody>`).

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: excellent
- **nova**: good
- **textract-llm**: excellent
