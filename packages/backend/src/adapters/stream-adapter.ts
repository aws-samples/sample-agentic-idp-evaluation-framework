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
}

export interface AdapterOutput {
  results: Record<string, { capability: string; data: unknown; confidence: number; format: string }>;
  rawOutput?: string;
  latencyMs: number;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
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
