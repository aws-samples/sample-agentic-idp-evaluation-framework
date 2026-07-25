/**
 * Shared extraction helpers used by LLM adapters (Bedrock Converse via
 * TokenStreamAdapter, and Bedrock Mantle OpenAI Responses via
 * MantleResponsesAdapter).
 *
 * Keeping the system-prompt construction and the (fragile, multi-strategy)
 * YAML/JSON response parsing in ONE place means every LLM path produces the
 * same capability-shaped output and the parsing behavior only has to be
 * correct once.
 */

import sharp from 'sharp';
import YAML from 'yaml';
import { CAPABILITY_INFO, filterModelBackedCapabilities } from '@idp/shared';

export const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
export const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|tiff|tif|bmp)$/i;
export const PDF_EXTENSION = /\.pdf$/i;
/**
 * Audio and video. The Converse API takes these as neither a text nor a document
 * content block, so a direct-LLM method cannot read them at all — only the
 * managed BDA path can. Used to keep such methods from being offered for media
 * instead of silently feeding the model a UTF-8 decode of an MP4.
 */
export const MEDIA_EXTENSIONS = /\.(mp4|mov|avi|mkv|webm|mp3|wav|flac|m4a|ogg)$/i;

/**
 * Video containers the Converse API accepts as a `video` content block, mapped to
 * its `VideoFormat` value.
 *
 * Converse genuinely supports video (base64 under 25 MB, or up to 1 GB from S3),
 * and Nova 2 Lite's service card lists video understanding as a core capability —
 * so routing every video to BDA was leaving a real capability unimplemented. `avi`
 * is absent because Converse's VideoFormat enum does not include it.
 */
export const CONVERSE_VIDEO_FORMATS: Record<string, string> = {
  mp4: 'mp4',
  mov: 'mov',
  mkv: 'mkv',
  webm: 'webm',
  flv: 'flv',
  mpeg: 'mpeg',
  mpg: 'mpg',
  wmv: 'wmv',
};

/** Converse video format for a file name, or undefined if not a supported video. */
export function converseVideoFormat(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext ? CONVERSE_VIDEO_FORMATS[ext] : undefined;
}

/**
 * Audio is NOT accepted by Converse as a content block — only text, image,
 * document and video are. Audio therefore has to go through the managed BDA path.
 */
export const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|ogg|amr)$/i;

/**
 * Newer Anthropic models on Bedrock REJECT the `temperature` inference param
 * with `ValidationException: "temperature" is deprecated for this model`.
 * Adaptive-thinking models control determinism via effort, not temperature.
 *
 * Verified live against Bedrock Converse (us-west-2):
 *   rejected → claude-opus-5, claude-opus-4-8, claude-opus-4-7, claude-sonnet-5
 *   accepted → claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5, nova-*
 *
 * Every Converse-based adapter must route its inferenceConfig through
 * `buildInferenceConfig()` so a new model id can never silently 400 again.
 */
const TEMPERATURE_UNSUPPORTED = /claude-(opus-5|opus-4-[78]|sonnet-5)/;

export function supportsTemperature(modelId: string): boolean {
  return !TEMPERATURE_UNSUPPORTED.test(modelId);
}

/**
 * Build a Bedrock Converse `inferenceConfig`, omitting `temperature` on models
 * that reject it. Use this instead of hand-writing `{ maxTokens, temperature }`.
 */
export function buildInferenceConfig(
  modelId: string,
  maxTokens: number,
  temperature = 0,
): { maxTokens: number; temperature?: number } {
  const cfg: { maxTokens: number; temperature?: number } = { maxTokens };
  if (supportsTemperature(modelId)) cfg.temperature = temperature;
  return cfg;
}

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp';

export async function resizeImageIfNeeded(buffer: Buffer, format: string): Promise<Buffer> {
  if (buffer.length <= MAX_IMAGE_BYTES) return buffer;
  const ratio = Math.sqrt(MAX_IMAGE_BYTES / buffer.length);
  const metadata = await sharp(buffer).metadata();
  const newWidth = Math.round((metadata.width ?? 2000) * ratio);
  let img = sharp(buffer).resize({ width: newWidth, withoutEnlargement: true });
  if (format === 'jpeg' || format === 'jpg') img = img.jpeg({ quality: 80 });
  else if (format === 'png') img = img.png({ compressionLevel: 8 });
  else img = img.jpeg({ quality: 80 });
  return img.toBuffer();
}

export function getImageFormat(fileName: string): ImageFormat {
  const ext = fileName.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'jpeg';
  const map: Record<string, ImageFormat> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', tiff: 'jpeg', tif: 'jpeg', bmp: 'jpeg' };
  return map[ext] ?? 'jpeg';
}

export const CAPABILITY_GUIDANCE: Record<string, string> = {
  document_summarization: 'Write a coherent text summary of the document content. Do NOT output tables or HTML. Output plain text paragraphs.',
  text_extraction: 'Extract all visible text preserving reading order. Output as plain text.',
  table_extraction: 'Extract tables as HTML <table> with proper <thead>/<tbody>/<tr>/<td>. Only extract ACTUAL tables visible in the document. Do NOT invent empty tables.',
  kv_extraction: 'Extract key-value pairs as JSON object {key: value}.',
  image_description: 'Describe images, charts, and diagrams in the document as text.',
  entity_extraction: 'Extract named entities (names, dates, amounts, addresses) as JSON.',
  document_classification: 'Classify the document type (invoice, contract, form, etc.).',
  document_splitting: 'Identify logical document boundaries and page ranges.',
  language_detection: 'Detect all languages present in the document.',
  pii_detection: 'Identify PII (names, SSN, phone numbers, etc.) and their locations.',
  /*
   * Bounding boxes: the coordinate SPACE has to be pinned, or the model is free to
   * answer in pixels, percentages or its own invented scale — and the answer is
   * then unusable even when the boxes are visually right. A 0-1000 normalized
   * integer grid is the technique validated over 336 real scanned pages in the
   * hybrid vision + spatial reasoning pattern
   * (~/workspaces/35-hybrid-vision-spatial-reasoning): Nova 2 Lite emits boxes on
   * that grid natively, and keeping every stage on one space means no conversion
   * between calls. Without this guidance the capability fell through to the
   * generic "Extract bounding box data." instruction.
   */
  bounding_box: 'Return one entry per detected element as JSON: '
    + '[{"label": "<what it is>", "bbox": [x1, y1, x2, y2]}]. '
    + 'Coordinates MUST be integers on a 0-1000 normalized grid — x from 0 (left) '
    + 'to 1000 (right), y from 0 (top) to 1000 (bottom) — NOT pixels and NOT '
    + 'percentages. Each box must hug its element tightly: for a text line, y1 at '
    + 'the cap height of the tallest letter and y2 at the bottom of the lowest '
    + 'descender (g, j, p, q, y); for a photo, the image frame only, excluding any '
    + 'caption above or below it. Emit one box per distinct element — a grid of '
    + 'portraits is many boxes, a single group photo is one.',
  layout_analysis: 'Identify the page structure in reading order as JSON: titles, '
    + 'section headers, paragraphs, lists, tables, figures, headers/footers and '
    + 'page numbers. Give each region a type and its order index, and include a '
    + 'bbox on a 0-1000 normalized integer grid when position is requested.',
  signature_detection: 'Report each signature region as JSON with a bbox on a '
    + '0-1000 normalized integer grid and whether it appears signed or blank. Do '
    + 'NOT attempt to identify who signed, and do not treat printed names as '
    + 'signatures.',
  barcode_qr: 'Report each barcode or QR code as JSON with its symbology if '
    + 'identifiable and a bbox on a 0-1000 normalized integer grid. Only decode a '
    + 'payload if the characters are legibly rendered as text; otherwise return the '
    + 'location with a null value rather than guessing digits.',

  /*
   * Media capabilities had NO guidance, so each fell through to the generic
   * "Extract video summarization data." instruction — and that alone was enough to
   * make the whole feature return nothing.
   *
   * Proven by A/B against the live model (us.amazon.nova-2-lite-v1:0), same 9s
   * video, same bytes, only the prompt differing:
   *   generic instruction  -> `data: []`, confidence 0
   *   guidance below       -> full summary, confidence 0.9, all ground-truth
   *                           strings recovered ("INVOICE 12345", "TOTAL 500 USD",
   *                           "DUE 2026-08-15")
   * The model was always capable; we were asking the wrong question. Note the
   * empty answer was ALSO reported to the user as a priced success, which is why
   * `isEmptyExtraction` now exists.
   */
  video_summarization: 'Summarise the video as JSON: an overall summary, the key '
    + 'themes and events in order, any speakers you can distinguish, and all '
    + 'on-screen text verbatim. Give each notable event an approximate timestamp '
    + '(mm:ss). Describe what is actually visible and audible — do not speculate '
    + 'about intent or off-screen context.',
  video_chapter_extraction: 'Divide the video into chapters as JSON: '
    + '[{"start": "mm:ss", "end": "mm:ss", "title": "<short title>", '
    + '"summary": "<what happens>"}]. Cut a new chapter where the subject or scene '
    + 'genuinely changes, not at fixed intervals, and cover the full duration with '
    + 'no gaps or overlaps.',
  audio_transcription: 'Transcribe all speech verbatim as JSON segments: '
    + '[{"start": "mm:ss", "speaker": "<label>", "text": "<verbatim speech>"}]. '
    + 'Label speakers consistently (Speaker 1, Speaker 2) without inventing names, '
    + 'transcribe in the language spoken, and mark unintelligible spans [inaudible] '
    + 'rather than guessing.',
  audio_summarization: 'Summarise the audio as plain text: what is discussed, by '
    + 'whom, and any decisions or action items stated. Base it only on what is '
    + 'actually said.',
  content_moderation: 'Report policy-relevant content as JSON: '
    + '[{"category": "<violence|nudity|hate|self-harm|drugs|profanity|other>", '
    + '"timestamp": "mm:ss", "severity": "<low|medium|high>", '
    + '"evidence": "<what was seen or heard>"}]. Return an empty list with high '
    + 'confidence when the content is clean — that is a finding, not a failure.',
};

/**
 * Capabilities whose input is a video or audio stream rather than a page.
 *
 * The system prompt used to say "document processing AI" and "from the document"
 * unconditionally, so a video request told the model to read a document that was
 * not there. That wording alone produced empty extractions (see the A/B above).
 */
const MEDIA_PROMPT_CAPABILITIES = new Set([
  'video_summarization',
  'video_chapter_extraction',
  'audio_transcription',
  'audio_summarization',
  'content_moderation',
]);

export function buildSystemPrompt(capabilities: string[], userInstruction?: string): string {
  // Drop capabilities no model can perform (pdf_conversion,
  // format_standardization — pipeline preprocessing steps). They previously
  // fell through to "Extract pdf conversion data.", which asks the model for
  // output that cannot exist and invites it to pad the response.
  const modelCapabilities = filterModelBackedCapabilities(capabilities);
  const effective = modelCapabilities.length > 0 ? modelCapabilities : capabilities;

  const capInstructions = effective.map((c) => {
    const info = CAPABILITY_INFO[c as keyof typeof CAPABILITY_INFO];
    const fmt = info?.defaultFormat ?? 'json';
    const guidance = CAPABILITY_GUIDANCE[c] ?? `Extract ${c.replace(/_/g, ' ')} data.`;
    return `- ${c} (format: ${fmt}): ${guidance}`;
  }).join('\n');

  const instructionBlock = userInstruction
    ? `\n\nUser's specific requirements (from interview):\n${userInstruction}\n\nTailor your extraction to match these requirements (language, style, detail level, etc.).`
    : '';

  /*
   * Name the medium the model was actually handed.
   *
   * "document processing AI … from the document" was unconditional, so a video
   * request instructed the model to read a document it had not been given. Nova
   * complied literally and returned `data: []` at confidence 0 — see the A/B in
   * CAPABILITY_GUIDANCE above, where only this wording and the missing per-capability
   * guidance changed between an empty answer and a complete one.
   */
  const isMedia = effective.some((c) => MEDIA_PROMPT_CAPABILITIES.has(c));
  const role = isMedia ? 'media processing AI' : 'document processing AI';
  const subject = isMedia ? 'media file provided' : 'document';
  const languageRule = isMedia
    ? '- Match the output language to the spoken or on-screen language'
    : '- Match the output language to the document language';

  return `You are a ${role}. Extract ONLY the requested capabilities from the ${subject}.

Capabilities to extract:
${capInstructions}
${instructionBlock}

RULES:
- Return YAML with each capability as a top-level key
- Each capability must have: data, confidence (0-1), format ("html"|"csv"|"json"|"text")
- ONLY extract what is asked. Do NOT add extra capabilities
- Do NOT generate empty or placeholder data. If you cannot extract something, set confidence to 0
${languageRule}
- Return ONLY valid YAML. No markdown code blocks, no JSON`;
}

export type ParsedResults = Record<string, { capability: string; data: unknown; confidence: number; format: string }>;

/**
 * Parse the strict-JSON output of a two-stage adapter's structuring step.
 *
 * The BDA+LLM and Textract+LLM adapters each carried their own copy of this
 * function; the copies had already drifted apart (one defaulted missing
 * confidence to 0.8, the other to 0.7). One implementation means the two paths
 * cannot report differently for identical model output.
 *
 * Distinct from `parseResults` below, which handles the looser YAML-or-JSON
 * output of the direct-LLM extraction path.
 */
export function parseStructuredJsonResults(
  rawOutput: string,
  capabilities: string[],
  fallbackConfidence = 0.8,
): ParsedResults {
  const results: ParsedResults = {};

  let parsed: Record<string, unknown>;
  try {
    const cleaned = rawOutput.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
    parsed = JSON.parse(cleaned);
  } catch {
    // Unparseable output is still worth showing as text rather than discarding.
    for (const cap of capabilities) {
      results[cap] = { capability: cap, data: rawOutput, confidence: 0.5, format: 'text' };
    }
    return results;
  }

  for (const cap of capabilities) {
    const capData = parsed[cap] as Record<string, unknown> | undefined;
    if (capData && typeof capData === 'object' && 'data' in capData) {
      // For content_moderation, null/empty data means "nothing flagged", which
      // is a successful result rather than a missing one.
      const isSafeNull = capData.data == null && cap === 'content_moderation';
      results[cap] = {
        capability: cap,
        data: isSafeNull ? { safe: true, flags: [] } : capData.data,
        confidence: (capData.confidence as number) ?? (isSafeNull ? 0.95 : fallbackConfidence),
        format: (capData.format as string) ?? 'json',
      };
    } else {
      results[cap] = {
        capability: cap,
        data: capData ?? rawOutput,
        confidence: fallbackConfidence,
        format: 'json',
      };
    }
  }

  return results;
}

/**
 * Parse an LLM's raw text output into per-capability results. Tries YAML first
 * (handles truncation gracefully), then JSON, then several fence-stripping and
 * extraction fallbacks, and finally degrades to raw text per capability.
 */
export function parseResults(rawOutput: string, capabilities: string[]): ParsedResults {
  const results: ParsedResults = {};

  let parsed: Record<string, unknown> | null = null;

  const yamlFenceMatch = rawOutput.match(/```(?:yaml|YAML|yml)?\s*\n([\s\S]*?)\n\s*```/);
  const jsonFenceMatch = rawOutput.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```/);
  const cleanStrategies = [
    { content: rawOutput.trim(), parser: 'yaml' },
    { content: yamlFenceMatch?.[1]?.trim() ?? '', parser: 'yaml' },
    { content: rawOutput.replace(/^```(?:yaml|YAML|yml)?\s*\n/, '').replace(/\n\s*```\s*$/, '').trim(), parser: 'yaml' },
    { content: rawOutput.trim(), parser: 'json' },
    { content: jsonFenceMatch?.[1]?.trim() ?? '', parser: 'json' },
    { content: rawOutput.replace(/^```(?:json|JSON)?\s*\n/, '').replace(/\n\s*```\s*$/, '').trim(), parser: 'json' },
    { content: rawOutput.match(/(\{[\s\S]*\})/)?.[1]?.trim() ?? '', parser: 'json' },
  ];

  for (const { content, parser } of cleanStrategies) {
    if (!content) continue;
    try {
      const candidate = parser === 'yaml' ? YAML.parse(content) : JSON.parse(content);
      if (candidate && typeof candidate === 'object') {
        parsed = candidate;
        break;
      }
    } catch {
      // Try next strategy
    }
  }

  if (!parsed) {
    for (const cap of capabilities) {
      results[cap] = { capability: cap, data: rawOutput, confidence: 0.5, format: 'text' };
    }
    return results;
  }

  for (const cap of capabilities) {
    const capData = (parsed[cap] ?? parsed[cap.replace(/_/g, ' ')] ?? parsed[cap.replace(/_/g, '-')]) as Record<string, unknown> | string | undefined;

    if (capData && typeof capData === 'object' && 'data' in capData) {
      const isSafeNull = capData.data == null && cap === 'content_moderation';
      const defaultFmt = CAPABILITY_INFO[cap as keyof typeof CAPABILITY_INFO]?.defaultFormat ?? 'json';
      results[cap] = {
        capability: cap,
        data: isSafeNull ? { safe: true, flags: [] } : capData.data,
        confidence: (capData.confidence as number) ?? (isSafeNull ? 0.95 : 0.85),
        format: (capData.format as string) ?? defaultFmt,
      };
    } else if (capData != null) {
      const format = CAPABILITY_INFO[cap as keyof typeof CAPABILITY_INFO]?.defaultFormat ?? 'json';
      results[cap] = { capability: cap, data: capData, confidence: 0.8, format };
    } else {
      results[cap] = {
        capability: cap,
        data: rawOutput.length > 0 ? rawOutput : null,
        confidence: rawOutput.length > 0 ? 0.3 : 0,
        format: 'text',
      };
    }
  }

  return results;
}
