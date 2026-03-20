import { useState, useCallback } from 'react';
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

  const runPreview = useCallback(async (documentId: string, s3Uri: string, capabilities: Capability[], userInstruction?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, s3Uri, capabilities, userInstruction }),
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
