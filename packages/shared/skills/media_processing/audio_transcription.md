---
id: "audio_transcription"
name: "Audio Transcription"
description: "Full speech-to-text transcription with speaker labeling (up to 30 speakers), channel separation, and timestamps. Supports 11 languages."
category: "media_processing"
categoryName: "Media Processing"
icon: "mic"
defaultFormat: "json"
tags: ["audio", "transcript", "speech", "speaker", "wav", "mp3", "flac"]
exampleInput: "Customer support call recording (WAV/MP3)"
exampleOutput: "Timestamped transcript with speaker labels (spk_0, spk_1)"
support:
  bda: "excellent"
  bda-llm: "excellent"
  claude: "good"
  nova: "good"
---

# Audio Transcription

Full speech-to-text transcription with speaker labeling (up to 30 speakers), channel separation, and timestamps. Supports 11 languages.

## When to use

Use this skill when the user needs to full speech-to-text transcription with speaker labeling (up to 30 speakers), channel separation, and timestamps. supports 11 languages..

## Example

**Input**: Customer support call recording (WAV/MP3)

**Output**: Timestamped transcript with speaker labels (spk_0, spk_1)

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **bda**: excellent
- **bda-llm**: excellent
- **claude**: good
- **nova**: good
