---
id: "image_separation"
name: "Image Separation"
description: "Extract embedded images, charts, and figures from documents. Separate visual elements from text for independent OCR and analysis."
category: "advanced_ai"
categoryName: "Advanced AI"
icon: "image-off"
defaultFormat: "json"
tags: ["image", "extract", "separate", "figure", "chart", "embedded", "ocr"]
exampleInput: "PDF with embedded product photos and charts"
exampleOutput: "Individual images extracted with captions and page locations"
support:
  bda: "good"
  bda-llm: "good"
  claude: "good"
  nova: "good"
---

# Image Separation

Extract embedded images, charts, and figures from documents. Separate visual elements from text for independent OCR and analysis.

## When to use

Use this skill when the user needs to embedded images, charts, and figures from documents. separate visual elements from text for independent ocr and analysis..

## Example

**Input**: PDF with embedded product photos and charts

**Output**: Individual images extracted with captions and page locations

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: good
- **bda-llm**: good
- **claude**: good
- **nova**: good
