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

    const isTextractSupported = /\.(pdf|jpg|jpeg|png|tiff|tif)$/i.test(fileName);
    if (!isTextractSupported) {
      throw new Error(
        `Guardrails requires text input; ${fileName.split('.').pop()?.toUpperCase()} is not supported via Textract. Use a direct-LLM method first.`,
      );
    }

    // Phase 1 — OCR.
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

    const text = this.blocksToText(blocks);
    emitProgress(res, this.method, 'all', 45, `Extracted ${text.length} chars. Applying guardrail...`);

    // Phase 2 — ApplyGuardrail.
    const content: GuardrailContentBlock[] = [{ text: { text } }];
    const applyCmd = new ApplyGuardrailCommand({
      guardrailIdentifier: config.bedrockGuardrailId,
      guardrailVersion: config.bedrockGuardrailVersion,
      source: 'INPUT',
      outputScope: 'FULL',
      content,
    });

    const resp = await bedrockClient.send(applyCmd);
    emitProgress(res, this.method, 'all', 95, 'Guardrail complete');

    // Collect every PII hit across all assessments, plus any regex hits.
    type Hit = { type: string; match: string; action?: string; regexName?: string };
    const hits: Hit[] = [];
    for (const assessment of resp.assessments ?? []) {
      const pii = assessment.sensitiveInformationPolicy?.piiEntities ?? [];
      for (const entity of pii) {
        if (!entity.detected || !entity.match || !entity.type) continue;
        hits.push({ type: entity.type, match: entity.match, action: entity.action });
      }
      const regexes = assessment.sensitiveInformationPolicy?.regexes ?? [];
      for (const rx of regexes) {
        if (!rx.detected || !rx.match || !rx.name) continue;
        hits.push({ type: rx.name, match: rx.match, action: rx.action, regexName: rx.name });
      }
    }

    // Confidence: Guardrails is deterministic. Treat it as 0.95 when any hit was found,
    // 0.7 when text was scanned but no PII was present (true negative), 0 if scan failed.
    const confidence = hits.length > 0 ? 0.95 : (text.length > 0 ? 0.7 : 0);

    const redactedText = this.redactText(text, hits);

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
        action: resp.action,
        actionReason: resp.actionReason,
        hits,
        textScanned: text.length,
        usage: resp.usage,
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
