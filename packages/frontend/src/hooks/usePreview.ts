import { useState, useCallback } from 'react';
import type { Capability } from '@idp/shared';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ActualCost {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface MethodResult {
  method: string;
  shortName: string;
  results: Record<string, unknown>;
  rawText: string;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  actualCost?: ActualCost;
  error?: string;
}

export interface MethodInfo {
  method: string;
  shortName: string;
  tokenPricing?: { input: number; output: number };
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
  runPreview: (documentId: string, s3Uri: string, capabilities: Capability[]) => Promise<void>;
}

export function usePreview(): UsePreviewResult {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useCallback(async (documentId: string, s3Uri: string, capabilities: Capability[]) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, s3Uri, capabilities }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Preview failed (${res.status})`);
      }

      const data: PreviewResponse = await res.json();
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { preview, isLoading, error, runPreview };
}
