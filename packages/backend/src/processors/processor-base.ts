import type { Response } from 'express';
import type { ProcessingMethod, ProcessorResult, CapabilityResult } from '@idp/shared';
import type { StreamAdapter, AdapterInput } from '../adapters/stream-adapter.js';
import { emitSSE } from '../services/streaming.js';
import { calculateCost } from '../services/pricing.js';

export abstract class ProcessorBase {
  abstract readonly method: ProcessingMethod;
  abstract readonly adapter: StreamAdapter;

  async process(
    res: Response | null,
    input: AdapterInput,
  ): Promise<ProcessorResult> {
    if (res) emitSSE(res, { type: 'method_start', method: this.method });

    try {
      const output = await this.adapter.run(res, input);

      const capResults: Record<string, CapabilityResult> = {};
      for (const [key, val] of Object.entries(output.results)) {
        capResults[key] = {
          capability: val.capability as CapabilityResult['capability'],
          data: val.data,
          confidence: val.confidence,
          format: val.format as CapabilityResult['format'],
        };
      }

      const confidences = Object.values(capResults).map((r) => r.confidence);
      const avgConfidence =
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0;

      const result: ProcessorResult = {
        method: this.method,
        status: 'complete',
        results: capResults,
        metrics: {
          latencyMs: output.latencyMs,
          cost: calculateCost(this.method, input.pageCount, output.tokenUsage),
          confidence: avgConfidence,
          tokenUsage: output.tokenUsage,
        },
        rawOutput: output.rawOutput,
      };

      if (res) emitSSE(res, { type: 'method_complete', method: this.method, data: result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Always log method errors so we can debug preview failures from App
      // Runner logs without having to plumb the SSE stream.
      console.error(`[${this.method}] method failed:`, message);
      if (res) emitSSE(res, { type: 'method_error', method: this.method, error: message });

      return {
        method: this.method,
        status: 'error',
        results: {},
        metrics: {
          latencyMs: 0,
          cost: 0,
        },
        error: message,
      };
    }
  }
}
