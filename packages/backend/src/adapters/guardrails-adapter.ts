import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import {
  AnalyzeDocumentCommand,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  type Block,
} from '@aws-sdk/client-textract';
import {
  ApplyGuardrailCommand,
  type GuardrailContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { textractClient, bedrockClient, config } from '../config/aws.js';
import { isOfficeFormat, convertOfficeDocument } from '../services/file-converter.js';

// Bedrock ApplyGuardrail enforces a text cap per request. We keep a safety
// margin under the documented 25 KB so multi-byte UTF-8 characters and
// network envelope overhead still fit.
export const GUARDRAILS_CHUNK_BYTES = 20 * 1024;

/**
 * Split text into chunks that each stay under `maxBytes` when encoded as UTF-8.
 * Splits on newline boundaries when possible to avoid breaking mid-sentence;
 * falls back to hard byte cut-off for pathological inputs.
 */
export function chunkUtf8(text: string, maxBytes: number): string[] {
  if (!text) return [''];
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (enc.encode(candidate).length > maxBytes && current) {
      flush();
      current = line;
    } else {
      current = candidate;
    }
    while (enc.encode(current).length > maxBytes) {
      // Single line exceeds budget — hard cut by approximate char count.
      let cut = Math.floor(current.length * (maxBytes / enc.encode(current).length));
      if (cut <= 0) cut = 1;
      chunks.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  flush();
  return chunks;
}

/**
 * Amazon Bedrock Guardrails adapter.
 *
 * Two phases:
 *   1. Extract text with Amazon Textract (sync for single page / small PDFs,
 *      async + NextToken pagination for multi-page PDFs).
 *   2. Submit the extracted text to `ApplyGuardrail` with `source: INPUT`
 *      and parse `sensitiveInformationPolicy.piiEntities` + `regexes` into
 *      the capability shape the rest of the pipeline expects.
 *
 * Only two capabilities make sense here:
 *   - pii_detection — returns the list of detected PII entities
 *   - pii_redaction — returns the text with each PII entity replaced by
 *     [REDACTED:<type>], built from the guardrail's `match` offsets.
 *
 * Other capabilities passed in are echoed back with confidence 0 so the
 * downstream comparison UI can render "unsupported" consistently.
 */
export class GuardrailsAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();
    const fileName = input.fileName;

    if (!config.bedrockGuardrailId) {
      throw new Error('Bedrock Guardrails not configured (BEDROCK_GUARDRAIL_ID is empty)');
    }

    // Phase 1 — OCR (or skip when the pipeline has already handed us the text).
    let text: string;
    if (input.precomputedText && input.precomputedText.length > 0) {
      text = input.precomputedText;
      emitProgress(res, this.method, 'all', 45, `Received ${text.length} chars from upstream stage. Applying guardrail...`);
    } else {
      const isTextractSupported = /\.(pdf|jpg|jpeg|png|tiff|tif)$/i.test(fileName);
      const isZipFile = input.documentBuffer[0] === 0x50 && input.documentBuffer[1] === 0x4B;
      if (!isTextractSupported && isOfficeFormat(fileName) && isZipFile) {
        emitProgress(res, this.method, 'all', 0, 'Converting Office document to text...');
        const converted = await convertOfficeDocument(input.documentBuffer, fileName);
        text = converted.text;
        emitProgress(res, this.method, 'all', 45, `Converted ${text.length} chars. Applying guardrail...`);
      } else if (!isTextractSupported) {
        throw new Error(
          `Guardrails requires text input; ${fileName.split('.').pop()?.toUpperCase()} is not supported via Textract. Use a direct-LLM method first.`,
        );
      } else {

      emitProgress(res, this.method, 'all', 0, 'Extracting text with Textract...');

      const isPDF = /\.pdf$/i.test(fileName);
      const isMultiPage = isPDF && ((input.pageCount ?? 1) > 1 || input.documentBuffer.length > 5 * 1024 * 1024);

      let blocks: Block[];
      if (isMultiPage && input.s3Uri && !input.s3Uri.startsWith('local://')) {
        blocks = await this.runAsyncTextract(res, input.s3Uri);
      } else {
        const r = await textractClient.send(
          new AnalyzeDocumentCommand({
            Document: { Bytes: input.documentBuffer },
            FeatureTypes: ['FORMS'],
          }),
        );
        blocks = r.Blocks ?? [];
      }

      text = this.blocksToText(blocks);
      emitProgress(res, this.method, 'all', 45, `Extracted ${text.length} chars. Applying guardrail...`);
      }
    }

    // Phase 2 — ApplyGuardrail. Bedrock enforces a per-request text size
    // cap (~25 KB). Chunk large inputs on UTF-8 byte boundaries and aggregate
    // the hits across chunks before redacting.
    type Hit = { type: string; match: string; action?: string; regexName?: string };
    const chunks = chunkUtf8(text, GUARDRAILS_CHUNK_BYTES);
    const hits: Hit[] = [];
    const guardrailRedactedChunks: string[] = [];
    let lastAction: string | undefined;
    let lastActionReason: string | undefined;
    let combinedUsage: Record<string, number> | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const content: GuardrailContentBlock[] = [{ text: { text: chunk } }];
      const applyCmd = new ApplyGuardrailCommand({
        guardrailIdentifier: config.bedrockGuardrailId,
        guardrailVersion: config.bedrockGuardrailVersion,
        // Use OUTPUT so PII/sensitive-info policies actually evaluate the text.
        // `source: INPUT` treats the text as user prompt and skips PII scans.
        source: 'OUTPUT',
        outputScope: 'FULL',
        content,
      });
      const resp = await bedrockClient.send(applyCmd);
      lastAction = resp.action ?? lastAction;
      lastActionReason = resp.actionReason ?? lastActionReason;
      if (resp.usage) {
        combinedUsage = combinedUsage ?? {};
        for (const [k, v] of Object.entries(resp.usage)) {
          if (typeof v === 'number') {
            combinedUsage[k] = (combinedUsage[k] ?? 0) + v;
          }
        }
      }
      for (const assessment of resp.assessments ?? []) {
        const pii = assessment.sensitiveInformationPolicy?.piiEntities ?? [];
        for (const entity of pii) {
          if (!entity.detected || !entity.type) continue;
          // Bedrock returns match="" when action=ANONYMIZED (the match is
          // already replaced in outputs[]). Keep the hit regardless so we
          // can report what was detected — redaction comes from outputs[].
          hits.push({ type: entity.type, match: entity.match ?? '', action: entity.action });
        }
        const regexes = assessment.sensitiveInformationPolicy?.regexes ?? [];
        for (const rx of regexes) {
          if (!rx.detected || !rx.name) continue;
          hits.push({ type: rx.name, match: rx.match ?? '', action: rx.action, regexName: rx.name });
        }
      }

      // Bedrock's `outputs[0].text` already contains anonymized markers like
      // `{EMAIL}`, `{PHONE}`. Prefer that over local split/replace; fall back
      // to the original chunk when guardrail returned no output (no PII found
      // or action=NONE), then let our local redactText handle any BLOCK hits.
      const guardrailOutput = resp.outputs?.[0]?.text;
      guardrailRedactedChunks.push(guardrailOutput ?? chunk);

      emitProgress(
        res,
        this.method,
        'all',
        50 + Math.round(((i + 1) / chunks.length) * 45),
        `Guardrail ${i + 1}/${chunks.length} complete`,
      );
    }
    emitProgress(res, this.method, 'all', 95, 'Guardrail complete');

    // Confidence: Guardrails is deterministic. Treat it as 0.95 when any hit was found,
    // 0.7 when text was scanned but no PII was present (true negative), 0 if scan failed.
    const confidence = hits.length > 0 ? 0.95 : (text.length > 0 ? 0.7 : 0);

    // Stitch the per-chunk guardrail outputs back together. For BLOCK-action
    // hits whose match is still present, run the local fallback redactor.
    const blockHits = hits.filter((h) => h.match && (h.action ?? '').toUpperCase() !== 'ANONYMIZED');
    const stitched = guardrailRedactedChunks.join('\n');
    const redactedText = this.redactText(stitched, blockHits);

    const results: AdapterOutput['results'] = {};
    for (const cap of input.capabilities) {
      if (cap === 'pii_detection') {
        results[cap] = {
          capability: cap,
          data: hits.map((h) => ({ type: h.type, value: h.match, action: h.action ?? 'BLOCK' })),
          confidence,
          format: 'json',
        };
      } else if (cap === 'pii_redaction') {
        results[cap] = {
          capability: cap,
          data: redactedText,
          confidence,
          format: 'text',
        };
      } else {
        // Any non-PII capability asked of Guardrails → mark unsupported (confidence 0).
        results[cap] = {
          capability: cap,
          data: null,
          confidence: 0,
          format: 'text',
        };
      }
    }

    emitProgress(res, this.method, 'all', 100, 'Complete');

    return {
      results,
      rawOutput: JSON.stringify({
        action: lastAction,
        actionReason: lastActionReason,
        hits,
        textScanned: text.length,
        chunks: chunks.length,
        usage: combinedUsage,
      }),
      latencyMs: Date.now() - start,
    };
  }

  private async runAsyncTextract(res: Response | null, s3Uri: string): Promise<Block[]> {
    const url = new URL(s3Uri);
    const bucket = url.hostname;
    const key = decodeURIComponent(url.pathname.slice(1));

    const startCmd = new StartDocumentAnalysisCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
      FeatureTypes: ['FORMS'],
    });
    const startResp = await textractClient.send(startCmd);
    const jobId = startResp.JobId;
    if (!jobId) throw new Error('Textract StartDocumentAnalysis returned no JobId');

    emitProgress(res, this.method, 'all', 10, 'Textract async started...');

    let status = 'IN_PROGRESS';
    let all: Block[] = [];
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await textractClient.send(new GetDocumentAnalysisCommand({ JobId: jobId }));
      status = r.JobStatus ?? 'FAILED';
      if (status === 'SUCCEEDED') {
        all = r.Blocks ?? [];
        let next = r.NextToken;
        while (next) {
          const page = await textractClient.send(new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: next }));
          all.push(...(page.Blocks ?? []));
          next = page.NextToken;
        }
        emitProgress(res, this.method, 'all', 40, `Textract extracted ${all.length} blocks`);
        return all;
      }
      if (status === 'FAILED' || status === 'PARTIAL_SUCCESS') {
        throw new Error(`Textract ${status}: ${r.StatusMessage ?? 'unknown'}`);
      }
    }
    throw new Error('Textract async timed out (3 minutes)');
  }

  private blocksToText(blocks: Block[]): string {
    const lines: string[] = [];
    for (const b of blocks) {
      if (b.BlockType === 'LINE' && b.Text) lines.push(b.Text);
    }
    return lines.join('\n');
  }

  private redactText(text: string, hits: { type: string; match: string }[]): string {
    // Replace each reported match with [REDACTED:<type>]. Guardrails returns the
    // matched substring verbatim, so a simple split-join works for all occurrences.
    let out = text;
    // Sort longest-first to avoid overlapping replacements (e.g. phone inside address).
    const sorted = [...hits].sort((a, b) => b.match.length - a.match.length);
    for (const hit of sorted) {
      if (!hit.match) continue;
      out = out.split(hit.match).join(`[REDACTED:${hit.type}]`);
    }
    return out;
  }
}
