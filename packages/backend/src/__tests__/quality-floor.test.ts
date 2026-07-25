import { describe, it, expect, beforeAll } from 'vitest';
import type { Capability, PipelineGenerateRequest, ProcessingMethod } from '@idp/shared';
import { CAPABILITIES, METHOD_INFO, getSupportLevel, getBestMethodsForCapability } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';

/**
 * Methods a single-capability pipeline selects, or `null` when the capability is
 * deliberately unroutable.
 *
 * `embedding_generation` and `knowledge_base_ingestion` map only to the
 * `embeddings` family, whose model is us-east-1 only while this app runs in
 * us-west-2 — the generator throws rather than emitting a node that could never
 * execute. That is correct behaviour, so it is skipped here rather than asserted
 * against.
 */
function methodsFor(
  capability: Capability,
  optimizeFor: 'balanced' | 'accuracy' | 'cost' | 'speed',
): ProcessingMethod[] | null {
  const request: PipelineGenerateRequest = {
    documentType: 'pdf',
    capabilities: [capability],
    optimizeFor,
    enableHybridRouting: false,
  };
  let pipeline;
  try {
    ({ pipeline } = generatePipeline(request));
  } catch (err) {
    if (/No processing method supports/.test(String(err))) return null;
    throw err;
  }
  return pipeline.nodes
    .filter((n) => n.type === 'method')
    .map((n) => (n.config as { method: ProcessingMethod }).method);
}

const STRATEGIES = ['balanced', 'accuracy', 'cost', 'speed'] as const;

/**
 * The cost and speed strategies used to sort the entire candidate list on price or
 * latency alone, ignoring how well the method performs the capability. Measured on
 * `bounding_box` after the per-tier support corrections: `cost` returned Nova 2
 * Lite and `speed` returned Claude Haiku, both rated `limited`, while capable
 * frontier tiers were available. "Cheapest" has to mean cheapest method that can
 * do the job, not cheapest method that will probably fail at it.
 */
describe('cost and speed strategies respect a capability quality floor', () => {
  beforeAll(() => {
    // The Guardrails routing rule is conditional on it being configured; without
    // this the PII rows would pass for the wrong reason.
    process.env.BEDROCK_GUARDRAIL_ID ||= 'test-guardrail';
  });

  it('never returns a `limited` method when a better one supports the capability', () => {
    const violations: string[] = [];
    for (const capability of CAPABILITIES) {
      const candidates = getBestMethodsForCapability(capability);
      // Only meaningful where a better-than-limited option actually exists.
      const hasBetter = candidates.some((m) => {
        const level = getSupportLevel(m, capability);
        return level === 'excellent' || level === 'good';
      });
      if (!hasBetter) continue;

      for (const optimizeFor of STRATEGIES) {
        for (const method of methodsFor(capability, optimizeFor) ?? []) {
          if (getSupportLevel(method, capability) === 'limited') {
            violations.push(`${capability}/${optimizeFor} -> ${method}`);
          }
        }
      }
    }
    expect(violations, `chose a 'limited' method where a better one exists:\n${violations.join('\n')}`)
      .toEqual([]);
  });

  it('still routes a capability whose only support is `limited`', () => {
    // The floor must degrade, not fail: bounding_box's family baselines are all
    // `limited` apart from the frontier overrides, and a capability could end up
    // with nothing better at all.
    for (const capability of CAPABILITIES) {
      const candidates = getBestMethodsForCapability(capability);
      if (candidates.length === 0) continue;
      for (const optimizeFor of STRATEGIES) {
        const selected = methodsFor(capability, optimizeFor);
        if (selected === null) continue; // deliberately unroutable, asserted elsewhere
        expect(selected.length, `${capability}/${optimizeFor}`).toBeGreaterThan(0);
      }
    }
  });

  it('cost is still cheaper-or-equal to accuracy within the usable pool', () => {
    // The floor must not invert the strategies: it narrows the pool, it does not
    // stop `cost` from being the cheap option inside it.
    for (const capability of CAPABILITIES) {
      if (getBestMethodsForCapability(capability).length < 2) continue;
      const cost = methodsFor(capability, 'cost');
      const accuracy = methodsFor(capability, 'accuracy');
      if (!cost?.length || !accuracy?.length) continue;
      // Compare like for like: both lists are single-capability pipelines.
      const sum = (ms: ProcessingMethod[]) =>
        ms.reduce((n, m) => n + METHOD_INFO[m].estimatedCostPerPage, 0);
      expect(sum(cost), `${capability}: cost strategy pricier than accuracy`)
        .toBeLessThanOrEqual(sum(accuracy));
    }
  });
});
