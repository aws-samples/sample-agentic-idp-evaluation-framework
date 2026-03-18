import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  ProcessingEvent,
  ProcessingMethod,
  ProcessorResult,
  ComparisonResult,
  Capability,
} from '@idp/shared';
import { useSSE } from './useSSE';

export interface MethodProgress {
  method: ProcessingMethod;
  status: 'pending' | 'processing' | 'complete' | 'error';
  overallProgress: number;
  capabilityProgress: Record<string, number>;
  partialResults: Record<string, string>;
  result: ProcessorResult | null;
  error: string | null;
}

export interface UseProcessingResult {
  methodProgress: Record<string, MethodProgress>;
  comparison: ComparisonResult | null;
  allComplete: boolean;
  finalResults: ProcessorResult[];
  isRunning: boolean;
  startProcessing: (
    documentId: string,
    s3Uri: string,
    capabilities: Capability[],
    methods: ProcessingMethod[],
  ) => void;
}

export function useProcessing(): UseProcessingResult {
  const [methodProgress, setMethodProgress] = useState<Record<string, MethodProgress>>({});
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [allComplete, setAllComplete] = useState(false);
  const [finalResults, setFinalResults] = useState<ProcessorResult[]>([]);
  const lastEventCount = useRef(0);

  const { events, status, start } = useSSE<ProcessingEvent>('/api/process');

  const isRunning = status === 'connecting' || status === 'streaming';

  useEffect(() => {
    if (events.length <= lastEventCount.current) return;

    const newEvents = events.slice(lastEventCount.current);
    lastEventCount.current = events.length;

    for (const event of newEvents) {
      switch (event.type) {
        case 'method_start':
          setMethodProgress((prev) => ({
            ...prev,
            [event.method]: {
              ...prev[event.method],
              method: event.method,
              status: 'processing',
              overallProgress: 0,
              capabilityProgress: prev[event.method]?.capabilityProgress ?? {},
              partialResults: prev[event.method]?.partialResults ?? {},
              result: null,
              error: null,
            },
          }));
          break;

        case 'method_progress':
          setMethodProgress((prev) => {
            const current = prev[event.method];
            if (!current) return prev;
            const capProg = { ...current.capabilityProgress, [event.data.capability]: event.data.progress };
            const partials = event.data.partial
              ? { ...current.partialResults, [event.data.capability]: event.data.partial }
              : current.partialResults;
            const vals = Object.values(capProg);
            const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            return {
              ...prev,
              [event.method]: {
                ...current,
                capabilityProgress: capProg,
                partialResults: partials,
                overallProgress: avg,
              },
            };
          });
          break;

        case 'method_complete':
          setMethodProgress((prev) => ({
            ...prev,
            [event.method]: {
              ...prev[event.method],
              method: event.method,
              status: 'complete',
              overallProgress: 100,
              capabilityProgress: prev[event.method]?.capabilityProgress ?? {},
              partialResults: prev[event.method]?.partialResults ?? {},
              result: event.data,
              error: null,
            },
          }));
          break;

        case 'method_error':
          setMethodProgress((prev) => ({
            ...prev,
            [event.method]: {
              ...prev[event.method],
              method: event.method,
              status: 'error',
              overallProgress: prev[event.method]?.overallProgress ?? 0,
              capabilityProgress: prev[event.method]?.capabilityProgress ?? {},
              partialResults: prev[event.method]?.partialResults ?? {},
              result: null,
              error: event.error,
            },
          }));
          break;

        case 'comparison_update':
          setComparison(event.data);
          break;

        case 'all_complete':
          setAllComplete(true);
          setFinalResults(event.data.results);
          setComparison(event.data.comparison);
          break;
      }
    }
  }, [events]);

  const startProcessing = useCallback(
    (
      documentId: string,
      s3Uri: string,
      capabilities: Capability[],
      methods: ProcessingMethod[],
    ) => {
      lastEventCount.current = 0;
      setAllComplete(false);
      setFinalResults([]);
      setComparison(null);

      const initial: Record<string, MethodProgress> = {};
      for (const m of methods) {
        initial[m] = {
          method: m,
          status: 'pending',
          overallProgress: 0,
          capabilityProgress: {},
          partialResults: {},
          result: null,
          error: null,
        };
      }
      setMethodProgress(initial);

      start({ documentId, s3Uri, capabilities, methods });
    },
    [start],
  );

  return { methodProgress, comparison, allComplete, finalResults, isRunning, startProcessing };
}
