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
  confidence?: number;
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
}

export interface UsePreviewResult {
  preview: PreviewResponse | null;
  isLoading: boolean;
  error: string | null;
  runPreview: (documentId: string, s3Uri: string, capabilities: Capability[], userInstruction?: string) => Promise<void>;
}

export function usePreview(): UsePreviewResult {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runPreview = useCallback(async (documentId: string, s3Uri: string, capabilities: Capability[], userInstruction?: string) => {
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
        body: JSON.stringify({ documentId, s3Uri, capabilities, userInstruction }),
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
              };
              setPreview({ ...currentPreview });
            } else if (event.type === 'method_result' && currentPreview) {
              currentPreview.results.push(event as MethodResult);
              setPreview({ ...currentPreview });
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
