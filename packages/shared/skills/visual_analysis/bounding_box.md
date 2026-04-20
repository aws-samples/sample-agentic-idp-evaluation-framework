---
id: "bounding_box"
name: "Bounding Box Detection"
description: "Detect and locate elements with precise spatial coordinates (x, y, width, height)"
category: "visual_analysis"
categoryName: "Visual Analysis"
icon: "crop"
defaultFormat: "json"
tags: ["bbox", "coordinates", "spatial", "detection", "region"]
exampleInput: "Yearbook page with photos"
exampleOutput: "[{"label": "face", "x": 120, "y": 45, "w": 80, "h": 100}]"
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "good"
  nova: "excellent"
  textract-llm: "good"
---

# Bounding Box Detection

Detect and locate elements with precise spatial coordinates (x, y, width, height)

## When to use

Use this skill when the user needs to and locate elements with precise spatial coordinates (x, y, width, height).

## Example

**Input**: Yearbook page with photos

**Output**: [{"label": "face", "x": 120, "y": 45, "w": 80, "h": 100}]

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: good
- **nova**: excellent
- **textract-llm**: good
