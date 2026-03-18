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
  capabilities: string[];
  pageCount: number;
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
