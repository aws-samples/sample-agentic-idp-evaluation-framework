import { METHOD_INFO, type CapabilityResult, type ProcessingMethod } from '@idp/shared';

/**
 * Merge per-method capability results according to the aggregator node's
 * declared strategy.
 *
 * The pipeline canvas draws an Aggregator node with a strategy
 * (best-confidence / best-cost / best-speed), but the executor merged results
 * with a blind `Object.assign` — whichever method happened to finish LAST
 * silently overwrote the others, so the strategy shown to the user had no
 * effect on the output. This resolves each capability independently using the
 * declared rule.
 */

export type AggregationStrategy = 'best-confidence' | 'best-cost' | 'best-speed' | 'merge-all';

export interface MethodContribution {
  method: ProcessingMethod;
  results: Record<string, CapabilityResult>;
  latencyMs: number;
  cost: number;
}

export interface AggregatedCapability extends CapabilityResult {
  /** Which method's answer won for this capability. */
  sourceMethod?: ProcessingMethod;
  /** Methods that also produced an answer, for transparency in the UI. */
  alternativeMethods?: ProcessingMethod[];
}

function scoreFor(
  strategy: AggregationStrategy,
  c: MethodContribution,
  result: CapabilityResult,
): number {
  switch (strategy) {
    case 'best-cost':
      // Lower cost wins. Fall back to the catalog estimate when a run reports
      // zero (BDA-only methods bill per page, not per token).
      return -(c.cost || METHOD_INFO[c.method]?.estimatedCostPerPage || 0);
    case 'best-speed':
      return -c.latencyMs;
    case 'best-confidence':
    default:
      return result.confidence ?? 0;
  }
}

/**
 * Resolve one winning answer per capability.
 *
 * Only results with actual data compete: a method that returned null or an
 * empty answer at high confidence must not beat a method that really extracted
 * something.
 */
export function aggregateResults(
  contributions: readonly MethodContribution[],
  strategy: AggregationStrategy = 'best-confidence',
): Record<string, AggregatedCapability> {
  const out: Record<string, AggregatedCapability> = {};
  const capabilities = new Set<string>();
  for (const c of contributions) {
    for (const cap of Object.keys(c.results)) capabilities.add(cap);
  }

  for (const cap of capabilities) {
    const candidates = contributions
      .map((c) => ({ contribution: c, result: c.results[cap] }))
      .filter((x): x is { contribution: MethodContribution; result: CapabilityResult } => !!x.result);

    if (candidates.length === 0) continue;

    const withData = candidates.filter((x) => hasData(x.result));
    const pool = withData.length > 0 ? withData : candidates;

    let best = pool[0];
    let bestScore = scoreFor(strategy, best.contribution, best.result);
    for (const cand of pool.slice(1)) {
      const score = scoreFor(strategy, cand.contribution, cand.result);
      if (score > bestScore) {
        best = cand;
        bestScore = score;
      }
    }

    out[cap] = {
      ...best.result,
      sourceMethod: best.contribution.method,
      alternativeMethods: pool
        .filter((x) => x.contribution.method !== best.contribution.method)
        .map((x) => x.contribution.method),
    };
  }

  return out;
}

/** Whether a capability result carries usable content. */
export function hasData(result: CapabilityResult): boolean {
  const d = (result as { data?: unknown }).data;
  if (d == null) return false;
  if (typeof d === 'string') return d.trim().length > 0;
  if (Array.isArray(d)) return d.length > 0;
  if (typeof d === 'object') return Object.keys(d as object).length > 0;
  return true;
}
