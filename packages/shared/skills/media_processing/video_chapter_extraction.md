---
id: "video_chapter_extraction"
name: "Video Chapter Extraction"
description: "Split video into meaningful chapters/scenes with timestamps, summaries, and IAB content classification."
category: "media_processing"
categoryName: "Media Processing"
icon: "film"
defaultFormat: "json"
tags: ["video", "chapter", "scene", "timestamp", "iab", "segmentation"]
exampleInput: "Training webinar recording"
exampleOutput: "Chapters with start/end times, summaries, and IAB categories"
support:
  bda: "excellent"
  bda-llm: "excellent"
  nova: "excellent"
---

# Video Chapter Extraction

Split video into meaningful chapters/scenes with timestamps, summaries, and IAB content classification.

## When to use

Use this skill when the user needs to split video into meaningful chapters/scenes with timestamps, summaries, and iab content classification..

## Example

**Input**: Training webinar recording

**Output**: Chapters with start/end times, summaries, and IAB categories

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **nova**: excellent
