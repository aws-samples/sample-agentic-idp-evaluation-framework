import { useState, useCallback } from 'react';
import type { Capability, ProcessorResult, ComparisonResult } from '@idp/shared';
import { authedFetch } from '../services/api.js';

export interface GeneratedCode {
  python: string | null;
  typescript: string | null;
  cdk: string | null;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export function useCodeGen() {
  const [code, setCode] = useState<GeneratedCode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateCode = useCallback(async (
    capabilities: Capability[],
    processingResults: ProcessorResult[],
    comparison?: ComparisonResult | null,
    pipelineMethods?: Record<string, string>,
  ) => {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await authedFetch('/api/architecture/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities, processingResults, comparison, pipelineMethods }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Code generation failed (${res.status})`);
      }

      const data = await res.json() as GeneratedCode;
      setCode(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code generation failed');
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { code, isGenerating, error, generateCode };
}
