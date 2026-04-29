import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import sharp from 'sharp';
import YAML from 'yaml';
import { PDFDocument } from 'pdf-lib';
import {
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bedrockClient } from '../config/aws.js';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';
import { CAPABILITY_INFO } from '@idp/shared';
import { isOfficeFormat, convertOfficeDocument } from '../services/file-converter.js';

// Bedrock Converse rejects PDFs > 100 pages. For large PDFs we slice into
// ≤CHUNK_PAGES chunks and merge results after processing.
const CHUNK_PAGES = 90; // safety margin under the 100-page cap
const CHUNK_OVERLAP_PAGES = 2; // preserves tables/sections that straddle boundaries

export async function splitPdfByPages(
  buffer: Buffer,
  chunkSize = CHUNK_PAGES,
  overlap = CHUNK_OVERLAP_PAGES,
): Promise<Buffer[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= chunkSize) return [buffer];

  const chunks: Buffer[] = [];
  const step = chunkSize - overlap;
  for (let start = 0; start < total; start += step) {
    const end = Math.min(start + chunkSize, total);
    const dst = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await dst.copyPages(src, pageIndices);
    pages.forEach((p) => dst.addPage(p));
    chunks.push(Buffer.from(await dst.save()));
    if (end === total) break;
  }
  return chunks;
}

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|tiff|tif|bmp)$/i;
const PDF_EXTENSION = /\.pdf$/i;

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp';

async function resizeImageIfNeeded(buffer: Buffer, format: string): Promise<Buffer> {
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

function getImageFormat(fileName: string): ImageFormat {
  const ext = fileName.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'jpeg';
  const map: Record<string, ImageFormat> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', tiff: 'jpeg', tif: 'jpeg', bmp: 'jpeg' };
  return map[ext] ?? 'jpeg';
}

const CAPABILITY_GUIDANCE: Record<string, string> = {
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

function buildSystemPrompt(capabilities: string[], userInstruction?: string): string {
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

export class TokenStreamAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  private get modelId(): string {
    return METHOD_INFO[this.method].modelId;
  }

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();
    const fileName = input.fileName;
    const isPdf = PDF_EXTENSION.test(fileName);
    const pageCount = input.pageCount ?? 1;

    // Auto-chunk PDFs over the Bedrock 100-page cap. Each chunk uses the same
    // prompt; results are YAML-merged after every chunk completes.
    if (isPdf && pageCount > CHUNK_PAGES) {
      emitProgress(res, this.method, 'all', 0, `Splitting ${pageCount}-page PDF into ≤${CHUNK_PAGES}-page chunks...`);
      const chunkBuffers = await splitPdfByPages(input.documentBuffer);
      const n = chunkBuffers.length;
      emitProgress(res, this.method, 'all', 2, `Processing ${n} chunks sequentially...`);

      const chunkResults: AdapterOutput[] = [];
      const agg: { inputTokens: number; outputTokens: number; totalTokens: number } = {
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
      };

      for (let i = 0; i < n; i++) {
        const pct = Math.round((i / n) * 90);
        emitProgress(res, this.method, 'all', pct, `Chunk ${i + 1}/${n}...`);
        const chunkInput: AdapterInput = {
          ...input,
          documentBuffer: chunkBuffers[i],
          // Estimate per-chunk page count for token budget; last chunk may be smaller.
          pageCount: Math.min(CHUNK_PAGES, pageCount - i * (CHUNK_PAGES - CHUNK_OVERLAP_PAGES)),
        };
        const chunkOut = await this.runSingle(res, chunkInput, /* emitProgress */ false);
        chunkResults.push(chunkOut);
        if (chunkOut.tokenUsage) {
          agg.inputTokens += chunkOut.tokenUsage.inputTokens;
          agg.outputTokens += chunkOut.tokenUsage.outputTokens;
          agg.totalTokens += chunkOut.tokenUsage.totalTokens;
        }
      }

      emitProgress(res, this.method, 'all', 95, 'Merging chunk results...');
      const merged = this.mergeChunkResults(chunkResults, input.capabilities);
      emitProgress(res, this.method, 'all', 100, `Complete (${n} chunks merged)`);

      return {
        results: merged,
        rawOutput: chunkResults.map((r, idx) => `--- chunk ${idx + 1}/${n} ---\n${r.rawOutput ?? ''}`).join('\n\n'),
        latencyMs: Date.now() - start,
        tokenUsage: agg.totalTokens > 0 ? agg : undefined,
      };
    }

    // Single-shot path (original behavior).
    return this.runSingle(res, input, true);
  }

  private async runSingle(
    res: Response | null,
    input: AdapterInput,
    emitFineGrainProgress: boolean,
  ): Promise<AdapterOutput> {
    const start = Date.now();
    if (emitFineGrainProgress) {
      emitProgress(res, this.method, 'all', 0, 'Sending document to model...');
    }

    const contentBlocks: ContentBlock[] = [];
    const fileName = input.fileName;

    if (IMAGE_EXTENSIONS.test(fileName)) {
      const format = getImageFormat(fileName);
      const resized = await resizeImageIfNeeded(input.documentBuffer, format);
      contentBlocks.push({
        image: { format, source: { bytes: resized } },
      });
    } else if (PDF_EXTENSION.test(fileName)) {
      contentBlocks.push({
        document: { name: 'document', format: 'pdf', source: { bytes: input.documentBuffer } },
      });
    } else if (isOfficeFormat(fileName)) {
      const converted = await convertOfficeDocument(input.documentBuffer, fileName);
      contentBlocks.push({ text: `Document content:\n${converted.text}` });
    } else {
      const text = input.documentBuffer.toString('utf-8');
      contentBlocks.push({ text: `Document content:\n${text}` });
    }

    contentBlocks.push({ text: `Process this document and extract: ${input.capabilities.join(', ')}` });

    const messages: Message[] = [
      { role: 'user', content: contentBlocks },
    ];

    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: buildSystemPrompt(input.capabilities, input.userInstruction) }],
      messages,
      inferenceConfig: {
        maxTokens: calculateMaxTokens(
          input.capabilities.length,
          input.pageCount ?? 1,
          'yaml',
          input.capabilities.some(isMediaCapability),
        ),
        temperature: 0,
      },
    });

    const response = await bedrockClient.send(command);

    let fullText = '';
    let tokenCount = 0;
    let tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;
          tokenCount++;

          if (emitFineGrainProgress) {
            const progress = Math.min(Math.floor((tokenCount / 100) * 90), 90);
            emitProgress(res, this.method, 'all', progress, chunk);
          }
        }
        if (event.metadata?.usage) {
          const u = event.metadata.usage;
          tokenUsage = {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            totalTokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
          };
        }
      }
    }

    if (emitFineGrainProgress) {
      emitProgress(res, this.method, 'all', 100, 'Complete');
    }

    const results = this.parseResults(fullText, input.capabilities);

    return {
      results,
      rawOutput: fullText,
      latencyMs: Date.now() - start,
      tokenUsage,
    };
  }

  /**
   * Merge per-chunk results into one object per capability.
   *
   *   - text / summary fields: concatenate with \n\n separators
   *   - JSON objects: shallow-merge (last chunk wins on key collision)
   *   - JSON arrays: concatenate (dedupe by stringified entry)
   *   - HTML tables: concatenate table blocks
   *   - confidence: average
   */
  private mergeChunkResults(
    chunks: AdapterOutput[],
    capabilities: string[],
  ): Record<string, { capability: string; data: unknown; confidence: number; format: string }> {
    const out: Record<string, { capability: string; data: unknown; confidence: number; format: string }> = {};
    for (const cap of capabilities) {
      const per = chunks
        .map((c) => c.results[cap])
        .filter((r): r is NonNullable<typeof r> => !!r);
      if (per.length === 0) {
        out[cap] = { capability: cap, data: null, confidence: 0, format: 'text' };
        continue;
      }
      const format = per[0].format ?? 'text';
      const avgConf = per.reduce((s, r) => s + (r.confidence ?? 0), 0) / per.length;

      let mergedData: unknown;
      const allStrings = per.every((r) => typeof r.data === 'string');
      const allArrays = per.every((r) => Array.isArray(r.data));
      const allObjects = per.every((r) => r.data && typeof r.data === 'object' && !Array.isArray(r.data));

      if (allStrings) {
        mergedData = per.map((r) => r.data as string).filter(Boolean).join('\n\n');
      } else if (allArrays) {
        const seen = new Set<string>();
        const combined: unknown[] = [];
        for (const r of per) {
          for (const item of (r.data as unknown[])) {
            const key = typeof item === 'string' ? item : JSON.stringify(item);
            if (seen.has(key)) continue;
            seen.add(key);
            combined.push(item);
          }
        }
        mergedData = combined;
      } else if (allObjects) {
        mergedData = Object.assign({}, ...per.map((r) => r.data as Record<string, unknown>));
      } else {
        mergedData = per.map((r) => r.data);
      }

      out[cap] = { capability: cap, data: mergedData, confidence: avgConf, format };
    }
    return out;
  }

  private parseResults(
    rawOutput: string,
    capabilities: string[],
  ): Record<string, { capability: string; data: unknown; confidence: number; format: string }> {
    const results: Record<string, { capability: string; data: unknown; confidence: number; format: string }> = {};

    let parsed: Record<string, unknown> | null = null;

    // Try multiple parsing strategies
    const yamlFenceMatch = rawOutput.match(/```(?:yaml|YAML|yml)?\s*\n([\s\S]*?)\n\s*```/);
    const jsonFenceMatch = rawOutput.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```/);
    const cleanStrategies = [
      // 1. Try YAML parse first (handles truncated content gracefully)
      { content: rawOutput.trim(), parser: 'yaml' },
      // 2. Extract YAML from code fences
      { content: yamlFenceMatch?.[1]?.trim() ?? '', parser: 'yaml' },
      // 3. Strip YAML code fences
      { content: rawOutput.replace(/^```(?:yaml|YAML|yml)?\s*\n/, '').replace(/\n\s*```\s*$/, '').trim(), parser: 'yaml' },
      // 4. Try JSON parse (fallback for old responses)
      { content: rawOutput.trim(), parser: 'json' },
      // 5. Extract JSON from code fences
      { content: jsonFenceMatch?.[1]?.trim() ?? '', parser: 'json' },
      // 6. Strip JSON code fences
      { content: rawOutput.replace(/^```(?:json|JSON)?\s*\n/, '').replace(/\n\s*```\s*$/, '').trim(), parser: 'json' },
      // 7. Find first JSON object in text
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
      // All parsing failed — return raw text per capability
      for (const cap of capabilities) {
        results[cap] = {
          capability: cap,
          data: rawOutput,
          confidence: 0.5,
          format: 'text',
        };
      }
      return results;
    }

    for (const cap of capabilities) {
      // Try exact key match, then underscore/space variations
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
        // Direct data (no wrapper)
        const format = CAPABILITY_INFO[cap as keyof typeof CAPABILITY_INFO]?.defaultFormat ?? 'json';
        results[cap] = {
          capability: cap,
          data: capData,
          confidence: 0.8,
          format,
        };
      } else {
        // Capability not found in LLM response — likely truncated output.
        // Provide a fallback from the raw text so downstream consumers still get usable data.
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
}
