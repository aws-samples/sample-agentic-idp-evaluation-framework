import type { ProcessorResult, ComparisonResult, ProcessingMethod } from '@idp/shared';
import { CAPABILITIES } from '@idp/shared';

function rank(values: number[], ascending: boolean): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => (ascending ? a.v - b.v : b.v - a.v));
  const ranks = new Array<number>(values.length);
  indexed.forEach((item, pos) => {
    ranks[item.i] = pos + 1;
  });
  return ranks;
}

export function buildComparison(results: ProcessorResult[]): ComparisonResult {
  const completed = results.filter((r) => r.status === 'complete');

  if (completed.length === 0) {
    return {
      methods: [],
      recommendation: 'No methods completed successfully.',
      capabilityMatrix: {},
    };
  }

  const latencies = completed.map((r) => r.metrics.latencyMs);
  const costs = completed.map((r) => r.metrics.cost);
  const confidences = completed.map((r) => r.metrics.confidence ?? 0);

  const speedRanks = rank(latencies, true);
  const costRanks = rank(costs, true);
  const confRanks = rank(confidences, false);

  const methods = completed.map((r, i) => {
    const overall = Math.round(
      (speedRanks[i] + costRanks[i] + confRanks[i]) / 3,
    );
    return {
      method: r.method,
      metrics: {
        latencyMs: r.metrics.latencyMs,
        cost: r.metrics.cost,
        confidence: r.metrics.confidence ?? 0,
      },
      rank: {
        speed: speedRanks[i],
        cost: costRanks[i],
        confidence: confRanks[i],
        overall,
      },
    };
  });

  methods.sort((a, b) => a.rank.overall - b.rank.overall);

  const capabilityMatrix: Record<
    string,
    Record<string, { supported: boolean; quality: string }>
  > = {};

  for (const cap of CAPABILITIES) {
    const methodResults: Record<string, { supported: boolean; quality: string }> = {};
    for (const r of completed) {
      const capResult = r.results[cap];
      if (capResult) {
        const quality =
          capResult.confidence >= 0.9
            ? 'excellent'
            : capResult.confidence >= 0.7
              ? 'good'
              : capResult.confidence >= 0.5
                ? 'fair'
                : 'poor';
        methodResults[r.method] = { supported: true, quality };
      } else {
        methodResults[r.method] = { supported: false, quality: 'none' };
      }
    }
    capabilityMatrix[cap] = methodResults;
  }

  const best = methods[0];
  const recommendation = `${best.method} provides the best overall balance of speed, cost, and accuracy for your document.`;

  return { methods, recommendation, capabilityMatrix };
}
