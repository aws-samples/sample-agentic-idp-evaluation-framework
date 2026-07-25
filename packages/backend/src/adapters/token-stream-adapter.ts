import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import { PDFDocument } from 'pdf-lib';
import {
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type VideoFormat,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bedrockClient } from '../config/aws.js';
import { applyOutputCap, calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';
import { isOfficeFormat, convertOfficeDocument } from '../services/file-converter.js';
import {
  IMAGE_EXTENSIONS,
  PDF_EXTENSION,
  MEDIA_EXTENSIONS,
  converseVideoFormat,
  getImageFormat,
  resizeImageIfNeeded,
  buildSystemPrompt,
  parseResults,
  buildInferenceConfig,
} from './extraction-shared.js';

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

/**
 * Converse accepts an inline (base64) video only under 25 MB; larger files must be
 * passed by S3 location, which supports up to 1 GB. Kept slightly under the
 * documented cap so base64 expansion and request envelope still fit.
 */
const VIDEO_INLINE_LIMIT_BYTES = 20 * 1024 * 1024;

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
    } else if (isOfficeFormat(fileName) && input.documentBuffer.length > 4 && input.documentBuffer[0] === 0x50 && input.documentBuffer[1] === 0x4B && input.documentBuffer[2] === 0x03 && input.documentBuffer[3] === 0x04) {
      const converted = await convertOfficeDocument(input.documentBuffer, fileName);
      contentBlocks.push({ text: `Document content:\n${converted.text}` });
    } else if (converseVideoFormat(fileName)) {
      /*
       * Video as a native Converse content block.
       *
       * Converse accepts video (base64 under 25 MB, or an S3 location up to 1 GB)
       * and Nova 2 Lite lists video understanding as a core capability, so sending
       * every video to BDA was leaving a real capability unimplemented. Prefer the
       * S3 location when we have one: it avoids base64-inflating a large file
       * through the request body, and lifts the 25 MB cap to 1 GB.
       */
      const format = converseVideoFormat(fileName) as VideoFormat;
      const useS3 = !!input.s3Uri
        && !input.s3Uri.startsWith('local://')
        && input.documentBuffer.length > VIDEO_INLINE_LIMIT_BYTES;

      if (useS3) {
        contentBlocks.push({ video: { format, source: { s3Location: { uri: input.s3Uri } } } });
      } else if (input.documentBuffer.length <= VIDEO_INLINE_LIMIT_BYTES) {
        contentBlocks.push({ video: { format, source: { bytes: input.documentBuffer } } });
      } else {
        throw new Error(
          `Video is ${Math.round(input.documentBuffer.length / 1024 / 1024)}MB, over the `
          + `${VIDEO_INLINE_LIMIT_BYTES / 1024 / 1024}MB inline limit, and no S3 object is available. `
          + 'Re-upload via S3 or use a Bedrock Data Automation method.',
        );
      }
    } else if (MEDIA_EXTENSIONS.test(fileName)) {
      /*
       * Audio cannot be sent to Converse as text or as a document
       * block. This used to fall through to the branch below, which ran
       * `.toString('utf-8')` over an MP4/MP3 container — so the model received
       * megabytes of mojibake and was asked to extract fields from it. It then
       * either hallucinated an answer or returned an empty one, and the run was
       * reported as a SUCCESS with a real cost attached, which is worse than an
       * error: nothing on screen said the output was meaningless.
       *
       * BDA is the path for media in this app; a direct-LLM method should say so.
       */
      throw new Error(
        `${METHOD_INFO[this.method]?.shortName ?? this.method} cannot read audio directly — `
        + 'the Converse API accepts text, image, document and video content blocks, but not audio. '
        + 'Use a Bedrock Data Automation method for audio files.',
      );
    } else {
      const text = input.documentBuffer.toString('utf-8');
      contentBlocks.push({ text: `Document content:\n${text}` });
    }

    contentBlocks.push({ text: `Process this document and extract: ${input.capabilities.join(', ')}` });

    const messages: Message[] = [
      { role: 'user', content: contentBlocks },
    ];

    const inferenceConfig = buildInferenceConfig(
      this.modelId,
      applyOutputCap(
        calculateMaxTokens(
          input.capabilities.length,
          input.pageCount ?? 1,
          'yaml',
          input.capabilities.some(isMediaCapability),
          this.modelId,
        ),
        input.maxOutputTokens,
      ),
    );

    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: buildSystemPrompt(input.capabilities, input.userInstruction) }],
      messages,
      inferenceConfig,
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

    const results = parseResults(fullText, input.capabilities);

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
}
