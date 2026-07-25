import { useState, useCallback, useRef } from 'react';
import { authedFetch } from '../services/api.js';
import type { Capability, MethodFamily } from '@idp/shared';

export interface CapabilityResult {
  capability: string;
  data: unknown;
  confidence: number;
  format: string;
}

export interface MethodResult {
  method: string;
  shortName: string;
  family: MethodFamily;
  status: 'complete' | 'error';
  results: Record<string, CapabilityResult>;
  rawOutput?: string;
  latencyMs: number;
  estimatedCost?: number;
  /** Mean confidence the MODEL reported about its own output. */
  confidence?: number;
  /**
   * Mean OCR confidence measured by Textract, for two-stage methods only.
   * The one confidence figure here that is not self-reported.
   */
  ocrConfidence?: number;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  /**
   * The model stopped at its output-token ceiling, so this result is a FRAGMENT —
   * the response was cut off mid-value and parsed as far as it went.
   *
   * Shown prominently because the failure is invisible otherwise: a table missing its
   * last rows renders as a perfectly good table, with the model's own confidence
   * beside it.
   */
  truncated?: boolean;
  error?: string;
}

export interface MethodInfo {
  method: string;
  shortName: string;
  family: string;
  tokenPricing?: { inputPer1MTokens: number; outputPer1MTokens: number };
}

export interface PreviewResponse {
  documentId: string;
  capabilities: Capability[];
  methods: MethodInfo[];
  results: MethodResult[];
  /**
   * Server-side run id, emitted with `preview_start`. Persisted by App so a
   * preview run stays recoverable from DynamoDB after a refresh.
   */
  runId?: string;
  /**
   * Writing systems detected in the extracted text, when the advisor interview did
   * not already supply a language.
   *
   * This exists because non-English routing was silently dependent on the
   * interview: `isMethodLanguageCompatible` correctly excludes BDA and
   * Textract+LLM for non-Latin documents, but it only fires when
   * `documentLanguages` is populated, and only the interview populated it. A user
   * who clicked "Skip questions" had a Korean document routed to methods that
   * measured 32-42% recall against known content.
   */
  detectedLanguages?: string[];
  detectedScripts?: string[];
}

export interface UsePreviewResult {
  preview: PreviewResponse | null;
  isLoading: boolean;
  error: string | null;
  runPreview: (documentId: string, s3Uri: string, capabilities: Capability[], userInstruction?: string, documentLanguages?: string[]) => Promise<void>;
}

/**
 * @param initialPreview Previously completed preview to start from, so a page
 *   refresh shows the results that were already paid for instead of silently
 *   re-running every method. App persists this; without it, reloading
 *   /conversation re-billed all ~19 methods on every refresh.
 */
export function usePreview(initialPreview?: PreviewResponse | null): UsePreviewResult {
  const [preview, setPreview] = useState<PreviewResponse | null>(initialPreview ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runPreview = useCallback(async (documentId: string, s3Uri: string, capabilities: Capability[], userInstruction?: string, documentLanguages?: string[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setPreview(null);

    try {
      const res = await authedFetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, s3Uri, capabilities, userInstruction, documentLanguages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Preview failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentPreview: PreviewResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'preview_start') {
              currentPreview = {
                documentId: event.documentId,
                capabilities: event.capabilities,
                methods: event.methods,
                results: [],
                runId: event.runId,
              };
              setPreview({ ...currentPreview });
            } else if (event.type === 'method_result' && currentPreview) {
              currentPreview.results.push(event as MethodResult);
              // New array identity, not just a new wrapper: consumers memoise on
              // `results`, and mutating the same array in place meant a pushed
              // result could be missed until the next event forced a re-render.
              setPreview({ ...currentPreview, results: [...currentPreview.results] });
            } else if (event.type === 'languages_detected' && currentPreview) {
              currentPreview.detectedLanguages = event.data?.languages;
              currentPreview.detectedScripts = event.data?.scripts;
              setPreview({ ...currentPreview, results: [...currentPreview.results] });
            } else if (event.type === 'preview_done' && currentPreview) {
              if (event.runId) currentPreview.runId = event.runId;
              setPreview({ ...currentPreview, results: [...currentPreview.results] });
            } else if (event.type === 'preview_error') {
              throw new Error(event.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { preview, isLoading, error, runPreview };
}
