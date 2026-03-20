---
id: "video_summarization"
name: "Video Summarization"
description: "Generate full video summary with key themes, events, and speaker identification. BDA analyzes visual and audio signals."
category: "media_processing"
categoryName: "Media Processing"
icon: "video"
defaultFormat: "json"
tags: ["video", "summary", "scene", "speaker", "mp4", "mov"]
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "good"
  nova: "good"
---

# Video Summarization

Generate full video summary with key themes, events, and speaker identification. BDA analyzes visual and audio signals.

## When to use

Use this skill when the user needs to full video summary with key themes, events, and speaker identification. bda analyzes visual and audio signals..

## Example

**Input**: Product demo video (MP4, up to 240 min)

**Output**: Full summary + per-chapter summaries with timestamps

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: good
- **nova**: good
