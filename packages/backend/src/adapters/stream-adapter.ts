import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { emitSSE } from '../services/streaming.js';

export interface StreamAdapter {
  readonly method: ProcessingMethod;
  run(res: Response | null, input: AdapterInput): Promise<AdapterOutput>;
}

export interface AdapterInput {
  documentBuffer: Buffer;
  s3Uri: string;
  fileName: string;
  capabilities: string[];
  pageCount: number;
  userInstruction?: string;
  /**
   * When set, adapters that can work from plain text (e.g. Guardrails) should
   * bypass their own OCR/extraction step and run against this text directly.
   * Used by sequential pipelines that pipe extraction output into a downstream
   * text-only stage.
   */
  precomputedText?: string;
  /**
   * Hard ceiling on output tokens for this run, overriding the size-based
   * budget. Preview uses it to keep a "quick look" quick: the generous budget
   * that prevents truncation on a full pipeline run also lets a model generate
   * until it hits that ceiling, which turned one preview method into a 161s
   * stall. Full runs leave this unset and keep the untruncated budget.
   */
  maxOutputTokens?: number;
}

export interface AdapterOutput {
  results: Record<string, { capability: string; data: unknown; confidence: number; format: string }>;
  rawOutput?: string;
  latencyMs: number;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  /**
   * Mean OCR confidence (0-1) for methods with a real OCR stage.
   *
   * Distinct from `results[].confidence`, which is the model grading its own
   * output. This is measured by Textract per recognised line, so it is the one
   * confidence number in the app that is not self-reported. Absent for methods
   * that have no OCR stage.
   */
  ocrConfidence?: number;
  /**
   * Per-page infrastructure fee actually incurred by this run, in USD.
   *
   * Set by adapters whose non-token cost depends on what they requested — the
   * Textract stage costs $0.0015/page for plain OCR but up to $0.065/page when
   * TABLES+FORMS are needed, so a fixed table value would misreport the run by
   * more than an order of magnitude in either direction.
   */
  perPageFee?: number;
  /**
   * True when the model stopped because it hit the output-token ceiling rather than
   * because it had finished.
   *
   * Bedrock reports this as `messageStop.stopReason === 'max_tokens'` and we were
   * discarding it, so a response cut off mid-JSON — `data: - {"label": "Benchmark`
   * with no closing brace — was parsed as far as it went and reported as a clean
   * success with the model's own confidence attached (0.88). The user then had no way
   * to tell a complete extraction from half of one.
   *
   * Truncation is a property of the RUN, not of any single capability, so it lives
   * here rather than on a result.
   */
  truncated?: boolean;
}

export function emitProgress(
  res: Response | null,
  method: ProcessingMethod,
  capability: string,
  progress: number,
  partial?: string,
): void {
  if (!res) return;
  emitSSE(res, {
    type: 'method_progress',
    method,
    data: { capability, progress, partial },
  });
}
