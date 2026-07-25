import type { Response } from 'express';
import type { ProcessingMethod, ProcessorResult, CapabilityResult } from '@idp/shared';
import type { StreamAdapter, AdapterInput } from '../adapters/stream-adapter.js';
import { emitSSE } from '../services/streaming.js';
import { calculateCost } from '../services/pricing.js';

/**
 * Whether an extracted value carries no information.
 *
 * Deliberately narrow: `[]`, `{}`, `null`, and whitespace-only strings are empty;
 * `0` and `false` are NOT — those are real answers to "how many" and "is it
 * signed". Used to catch a model that accepted the input and returned nothing.
 */
export function isEmptyExtraction(data: unknown): boolean {
  if (data == null) return true;
  if (typeof data === 'string') return data.trim().length === 0;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') return Object.keys(data as object).length === 0;
  return false;
}

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

      /*
       * A response that parsed is not the same as a response that answered.
       *
       * `status` was unconditionally 'complete' for anything the parser could read,
       * so a model that returned `data: []` with `confidence: 0` for every
       * capability was presented as a successful, priced result — indistinguishable
       * on screen from a real extraction. Found on video: Nova 2 Lite "succeeded" in
       * 919ms for $0.0004 having extracted nothing (root cause was our prompt, fixed
       * in extraction-shared.ts, but the silent success is the worse bug because it
       * hid the first one and would hide the next).
       *
       * A blank answer is reported as a failure the user can see. This is deliberately
       * conservative: it fires only when EVERY capability came back empty AND the
       * model's own confidence is zero, so a genuine "nothing to report" answer that
       * the model stands behind (a clean content-moderation scan, confidence 0.9)
       * still counts as success.
       */
      const allEmpty = Object.values(capResults).length > 0
        && Object.values(capResults).every((r) => isEmptyExtraction(r.data));
      if (allEmpty && avgConfidence === 0) {
        throw new Error(
          'Returned no data (every requested capability came back empty at zero '
          + 'confidence). The model accepted the input but extracted nothing — treat '
          + 'this as a failed run, not an empty document.',
        );
      }

      const result: ProcessorResult = {
        method: this.method,
        status: 'complete',
        results: capResults,
        metrics: {
          latencyMs: output.latencyMs,
          cost: calculateCost(this.method, input.pageCount, output.tokenUsage, output.perPageFee),
          confidence: avgConfidence,
          // Measured OCR confidence, where the method has an OCR stage. Kept
          // separate from `confidence` above, which is the model's self-report.
          ...(output.ocrConfidence != null ? { ocrConfidence: output.ocrConfidence } : {}),
          tokenUsage: output.tokenUsage,
        },
        rawOutput: output.rawOutput,
        // A fragment, not a failure: the parsed part is often still useful, so this
        // is surfaced rather than thrown. Throwing would discard tokens the user has
        // already paid for; hiding it would let half a table pass as a whole one.
        ...(output.truncated ? { truncated: true } : {}),
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
