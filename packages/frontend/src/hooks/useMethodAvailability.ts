import { useEffect, useState } from 'react';
import type { MethodFamily, ProcessingMethod } from '@idp/shared';
import { authedFetch } from '../services/api';

export interface MethodAvailabilityEntry {
  id: ProcessingMethod;
  family: MethodFamily;
  available: boolean;
  unavailableReason?: string;
  unavailableDetail?: string;
}

/**
 * Which methods this deployment can actually run.
 *
 * The UI used to present all methods as equally usable, so an unconfigured
 * backend (BDA without a profile ARN, Guardrails without a guardrail id) only
 * revealed itself as an error partway through a run. Fetching availability up
 * front lets the catalog mark those methods clearly instead.
 *
 * Failure here is non-blocking: if the request fails we simply do not annotate
 * anything, which is the previous behavior rather than an empty catalog.
 */
export function useMethodAvailability() {
  const [byId, setById] = useState<Record<string, MethodAvailabilityEntry> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/methods');
        if (!res.ok) return;
        const data = (await res.json()) as { methods: MethodAvailabilityEntry[] };
        if (cancelled) return;
        const map: Record<string, MethodAvailabilityEntry> = {};
        for (const m of data.methods) map[m.id] = m;
        setById(map);
      } catch {
        // Non-blocking: leave annotations off.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return {
    /** null while loading or when the request failed. */
    availabilityById: byId,
    isUnavailable: (id: ProcessingMethod) => byId?.[id]?.available === false,
    reasonFor: (id: ProcessingMethod) => byId?.[id]?.unavailableDetail,
  };
}
