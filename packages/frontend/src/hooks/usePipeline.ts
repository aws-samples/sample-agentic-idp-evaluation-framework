import { useState, useCallback, useRef } from 'react';
import type {
  PipelineDefinition,
  PipelineGenerateRequest,
  PipelineGenerateResponse,
  PipelineExecutionEvent,
  PipelineNodeType,
} from '@idp/shared';

export type NodeState = 'idle' | 'active' | 'complete' | 'error';

export interface NodeStateInfo {
  state: NodeState;
  progress?: number;
  metrics?: { latencyMs: number; cost: number };
  error?: string;
}

export interface UsePipelineResult {
  pipeline: PipelineDefinition | null;
  alternatives: PipelineDefinition[];
  nodeStates: Record<string, NodeStateInfo>;
  activeEdges: Set<string>;
  isGenerating: boolean;
  isExecuting: boolean;
  error: string | null;
  generatePipeline: (request: PipelineGenerateRequest) => Promise<void>;
  executePipeline: (pipeline: PipelineDefinition, documentId: string, s3Uri: string) => void;
  totalCost: number;
  totalLatencyMs: number;
  switchPipeline: (pipeline: PipelineDefinition) => void;
  stopExecution: () => void;
}

export function usePipeline(): UsePipelineResult {
  const [pipeline, setPipeline] = useState<PipelineDefinition | null>(null);
  const [alternatives, setAlternatives] = useState<PipelineDefinition[]>([]);
  const [nodeStates, setNodeStates] = useState<Record<string, NodeStateInfo>>({});
  const [activeEdges, setActiveEdges] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [totalLatencyMs, setTotalLatencyMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const generatePipeline = useCallback(async (request: PipelineGenerateRequest) => {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/pipeline/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Failed to generate pipeline (${res.status})`);
      }

      const data: PipelineGenerateResponse = await res.json();
      setPipeline(data.pipeline);
      setAlternatives(data.alternatives);

      // Initialize node states
      const states: Record<string, NodeStateInfo> = {};
      for (const node of data.pipeline.nodes) {
        states[node.id] = { state: 'idle' };
      }
      setNodeStates(states);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const stopExecution = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsExecuting(false);
  }, []);

  const executePipeline = useCallback((pipelineDef: PipelineDefinition, documentId: string, s3Uri: string) => {
    stopExecution();
    setError(null);
    setIsExecuting(true);
    setTotalCost(0);
    setTotalLatencyMs(0);
    setActiveEdges(new Set());

    // Reset node states
    const states: Record<string, NodeStateInfo> = {};
    for (const node of pipelineDef.nodes) {
      states[node.id] = { state: 'idle' };
    }
    setNodeStates(states);

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch('/api/pipeline/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pipelineId: pipelineDef.id,
            documentId,
            s3Uri,
            pipeline: pipelineDef,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `Failed to execute pipeline (${res.status})`);
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
            if (jsonStr === '[DONE]') continue;

            try {
              const event: PipelineExecutionEvent = JSON.parse(jsonStr);

              switch (event.type) {
                case 'node_start':
                  setNodeStates((prev) => ({
                    ...prev,
                    [event.nodeId]: { state: 'active' },
                  }));
                  break;

                case 'node_progress':
                  setNodeStates((prev) => ({
                    ...prev,
                    [event.nodeId]: {
                      state: 'active',
                      progress: event.progress,
                    },
                  }));
                  break;

                case 'node_complete':
                  setNodeStates((prev) => ({
                    ...prev,
                    [event.nodeId]: {
                      state: 'complete',
                      metrics: event.metrics,
                    },
                  }));
                  // Accumulate cost from completed nodes
                  if (event.metrics?.cost) {
                    setTotalCost((prev) => prev + event.metrics.cost);
                  }
                  if (event.metrics?.latencyMs) {
                    setTotalLatencyMs((prev) => Math.max(prev, event.metrics.latencyMs));
                  }
                  break;

                case 'node_error':
                  setNodeStates((prev) => ({
                    ...prev,
                    [event.nodeId]: {
                      state: 'error',
                      error: event.error,
                    },
                  }));
                  break;

                case 'edge_active':
                  setActiveEdges((prev) => new Set(prev).add(event.edgeId));
                  break;

                case 'pipeline_complete':
                  if (event.totalCost != null) setTotalCost(event.totalCost);
                  if (event.totalLatencyMs != null) setTotalLatencyMs(event.totalLatencyMs);
                  setIsExecuting(false);
                  break;

                case 'pipeline_error':
                  setError(event.error);
                  setIsExecuting(false);
                  break;
              }
            } catch {
              // Skip malformed events
            }
          }
        }

        setIsExecuting(false);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setIsExecuting(false);
          return;
        }
        setError(err instanceof Error ? err.message : 'Unknown error');
        setIsExecuting(false);
      }
    })();
  }, [stopExecution]);

  const switchPipeline = useCallback((newPipeline: PipelineDefinition) => {
    setPipeline(newPipeline);
    const states: Record<string, NodeStateInfo> = {};
    for (const node of newPipeline.nodes) {
      states[node.id] = { state: 'idle' };
    }
    setNodeStates(states);
    setActiveEdges(new Set());
  }, []);

  return {
    pipeline,
    alternatives,
    nodeStates,
    activeEdges,
    isGenerating,
    isExecuting,
    error,
    totalCost,
    totalLatencyMs,
    generatePipeline,
    executePipeline,
    switchPipeline,
    stopExecution,
  };
}
