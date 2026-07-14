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
import { CAPABILITY_INFO } from '@idp/shared';

export const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
export const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|tiff|tif|bmp)$/i;
export const PDF_EXTENSION = /\.pdf$/i;

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
};

export function buildSystemPrompt(capabilities: string[], userInstruction?: string): string {
  const capInstructions = capabilities.map((c) => {
    const info = CAPABILITY_INFO[c as keyof typeof CAPABILITY_INFO];
    const fmt = info?.defaultFormat ?? 'json';
    const guidance = CAPABILITY_GUIDANCE[c] ?? `Extract ${c.replace(/_/g, ' ')} data.`;
    return `- ${c} (format: ${fmt}): ${guidance}`;
  }).join('\n');

  const instructionBlock = userInstruction
    ? `\n\nUser's specific requirements (from interview):\n${userInstruction}\n\nTailor your extraction to match these requirements (language, style, detail level, etc.).`
    : '';

  return `You are a document processing AI. Extract ONLY the requested capabilities from the document.

Capabilities to extract:
${capInstructions}
${instructionBlock}

RULES:
- Return YAML with each capability as a top-level key
- Each capability must have: data, confidence (0-1), format ("html"|"csv"|"json"|"text")
- ONLY extract what is asked. Do NOT add extra capabilities
- Do NOT generate empty or placeholder data. If you cannot extract something, set confidence to 0
- Match the output language to the document language
- Return ONLY valid YAML. No markdown code blocks, no JSON`;
}

export type ParsedResults = Record<string, { capability: string; data: unknown; confidence: number; format: string }>;

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
