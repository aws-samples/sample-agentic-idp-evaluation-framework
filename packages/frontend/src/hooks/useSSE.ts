import { useState, useCallback, useRef, useEffect } from 'react';
import { authedFetch } from '../services/api.js';

export type SSEStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error';

export interface UseSSEResult<T> {
  events: T[];
  status: SSEStatus;
  error: string | null;
  start: (body: unknown) => void;
  stop: () => void;
}

export function useSSE<T = unknown>(url: string): UseSSEResult<T> {
  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<SSEStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Abort on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const start = useCallback(
    (body: unknown) => {
      stop();
      setEvents([]);
      setError(null);
      setStatus('connecting');

      const controller = new AbortController();
      abortRef.current = controller;

      (async () => {
        try {
          const res = await authedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(
              (errBody as { error?: string }).error ?? `Request failed (${res.status})`,
            );
          }

          if (!mountedRef.current) return;
          setStatus('streaming');

          const reader = res.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done || !mountedRef.current) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const jsonStr = trimmed.slice(6);
              if (jsonStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(jsonStr) as T;
                if (mountedRef.current) {
                  setEvents((prev) => [...prev, parsed]);
                }
              } catch {
                // skip malformed lines
              }
            }
          }

          if (mountedRef.current) setStatus('done');
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            if (mountedRef.current) setStatus('idle');
            return;
          }
          if (mountedRef.current) {
            setError(err instanceof Error ? err.message : 'Unknown error');
            setStatus('error');
          }
        }
      })();
    },
    [url, stop],
  );

  return { events, status, error, start, stop };
}
