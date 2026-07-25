import { describe, it, expect } from 'vitest';
import { CAPABILITIES, getBestMethodsForCapability, METHODS, type ProcessingMethod } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';
import { isMethodConfigured } from '../services/method-availability.js';
import { PROCESSOR_FACTORY_FOR_TEST as PREVIEW_REGISTRY } from '../routes/preview.js';

/**
 * The catalog advertises 33 capabilities and 22 methods. A capability that maps
 * only to a method with no processor is a dead end: it is selectable in the UI,
 * reported available, and produces a pipeline node that can never execute.
 *
 * Verified live before this was fixed: POST /api/pipeline/generate with
 * ["embedding_generation"] returned methods: ["nova-embeddings"], a method absent
 * from all three route registries and whose model is not offered in us-west-2.
 */
describe('catalog runnability', () => {
  const hasProcessor = (m: ProcessingMethod) => !!PREVIEW_REGISTRY[m];

  it('never reports a method as available when it has no processor', () => {
    for (const method of METHODS as readonly ProcessingMethod[]) {
      if (hasProcessor(method)) continue;
      expect(
        isMethodConfigured(method).available,
        `${method} has no processor but is reported available`,
      ).toBe(false);
    }
  });

  it('never emits a pipeline node for a method that cannot run', () => {
    // Every capability, every strategy: any method node must be executable.
    for (const capability of CAPABILITIES) {
      if (getBestMethodsForCapability(capability).length === 0) continue;
      for (const optimizeFor of ['balanced', 'accuracy', 'cost', 'speed'] as const) {
        let result;
        try {
          result = generatePipeline({
            documentType: 'pdf',
            capabilities: [capability],
            optimizeFor,
            enableHybridRouting: false,
          });
        } catch {
          // Nothing runnable supports it — an explicit failure, not a dead node.
          continue;
        }
        for (const node of result.pipeline.nodes.filter((n) => n.type === 'method')) {
          const method = (node.config as any).method as ProcessingMethod;
          expect(
            hasProcessor(method),
            `${capability}/${optimizeFor} produced un-runnable node ${method}`,
          ).toBe(true);
          expect(
            isMethodConfigured(method).available,
            `${capability}/${optimizeFor} produced unavailable node ${method}`,
          ).toBe(true);
        }
      }
    }
  });

  it('explains a skipped capability instead of dropping it silently', () => {
    const result = generatePipeline({
      documentType: 'pdf',
      capabilities: ['text_extraction', 'embedding_generation'],
      optimizeFor: 'balanced',
      enableHybridRouting: false,
    });
    const skipped = result.skippedCapabilities ?? [];
    expect(skipped.map((s) => s.capability)).toContain('embedding_generation');
    // The reason must be actionable, not a bare restatement.
    expect(skipped[0].reason.length).toBeGreaterThan(20);
    // The rest of the request still produced a working pipeline.
    expect(result.pipeline.nodes.some((n) => n.type === 'method')).toBe(true);
  });

  it('throws rather than returning an empty pipeline when nothing is routable', () => {
    expect(() => generatePipeline({
      documentType: 'pdf',
      capabilities: ['embedding_generation'],
      optimizeFor: 'balanced',
      enableHybridRouting: false,
    })).toThrowError(/No processing method supports/);
  });
});
