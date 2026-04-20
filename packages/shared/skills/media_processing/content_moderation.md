---
id: "content_moderation"
name: "Content Moderation"
description: "Detect inappropriate, unsafe, or offensive content in images, video, and audio. Covers 7 categories including violence, explicit content, hate symbols."
category: "media_processing"
categoryName: "Media Processing"
icon: "shield-alert"
defaultFormat: "json"
tags: ["moderation", "safety", "nsfw", "violence", "explicit", "compliance"]
exampleInput: "User-uploaded image or video"
exampleOutput: "Moderation flags with confidence scores per category"
support:
  bda: "excellent"
  bda-llm: "excellent"
  nova: "excellent"
---

# Content Moderation

Detect inappropriate, unsafe, or offensive content in images, video, and audio. Covers 7 categories including violence, explicit content, hate symbols.

## When to use

Use this skill when the user needs to inappropriate, unsafe, or offensive content in images, video, and audio. covers 7 categories including violence, explicit content, hate symbols..

## Example

**Input**: User-uploaded image or video

**Output**: Moderation flags with confidence scores per category

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **nova**: excellent
