import { useState, useCallback, useRef } from 'react';
import type { ProcessorResult, ComparisonResult, Capability } from '@idp/shared';

export interface CostProjectionData {
  scale: string;
  docsPerMonth: number;
  methods: { method: string; monthlyCost: number }[];
}

export interface UseArchitectureResult {
  text: string;
  diagram: string | null;
  costProjections: CostProjectionData[];
  isLoading: boolean;
  error: string | null;
  generate: (params: {
    capabilities: Capability[];
    processingResults: ProcessorResult[];
    comparison: ComparisonResult | null;
  }) => void;
}

export function useArchitecture(): UseArchitectureResult {
  const [text, setText] = useState('');
  const [diagram, setDiagram] = useState<string | null>(null);
  const [costProjections, setCostProjections] = useState<CostProjectionData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback((params: {
    capabilities: Capability[];
    processingResults: ProcessorResult[];
    comparison: ComparisonResult | null;
  }) => {
    abortRef.current?.abort();
    setText('');
    setDiagram(null);
    setCostProjections([]);
    setError(null);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch('/api/architecture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            capabilities: params.capabilities,
            processingResults: params.processingResults,
            comparison: params.comparison,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Architecture generation failed (${res.status})`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const jsonStr = trimmed.slice(6);

            try {
              const event = JSON.parse(jsonStr);

              switch (event.type) {
                case 'text':
                  setText((prev) => prev + event.data);
                  break;
                case 'diagram':
                  setDiagram(event.data);
                  break;
                case 'cost_projection':
                  setCostProjections((prev) => [...prev, event.data]);
                  break;
                case 'done':
                  break;
              }
            } catch {
              // Skip malformed events
            }
          }
        }

        setIsLoading(false);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setIsLoading(false);
          return;
        }
        setError(err instanceof Error ? err.message : 'Unknown error');
        setIsLoading(false);
      }
    })();
  }, []);

  return { text, diagram, costProjections, isLoading, error, generate };
}
