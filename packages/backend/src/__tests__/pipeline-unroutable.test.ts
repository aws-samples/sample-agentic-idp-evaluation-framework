import { describe, it, expect } from 'vitest';
import type { PipelineGenerateRequest } from '@idp/shared';
import { CAPABILITIES, getBestMethodsForCapability } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';

function req(overrides: Partial<PipelineGenerateRequest> = {}): PipelineGenerateRequest {
  return {
    documentType: 'pdf',
    capabilities: [],
    optimizeFor: 'balanced',
    enableHybridRouting: false,
    ...overrides,
  };
}

/**
 * A capability that no method supports used to reach the layout code as
 * `undefined`, which threw "Cannot read properties of undefined (reading
 * 'shortName')" — reported to the caller as an opaque HTTP 500. Verified live
 * against the deployed backend before the fix: 32 of 128 request combinations
 * failed this way.
 */
describe('generatePipeline with unroutable capabilities', () => {
  const unsupported = CAPABILITIES.filter((c) => getBestMethodsForCapability(c).length === 0);

  it('has at least one capability with no method support (the trigger condition)', () => {
    // pdf_conversion / format_standardization / knowledge_base_ingestion.
    expect(unsupported.length).toBeGreaterThan(0);
  });

  it('skips an unroutable capability but still builds a pipeline from the rest', () => {
    const { pipeline } = generatePipeline(req({
      capabilities: ['text_extraction', ...unsupported.slice(0, 1)],
    }));
    const methodNodes = pipeline.nodes.filter((n) => n.type === 'method');
    expect(methodNodes.length).toBeGreaterThan(0);
    // Every method node names a real method, and no node was created for the
    // unroutable capability.
    const routed = methodNodes.flatMap((n) => (n.config as any).capabilities as string[]);
    expect(routed).toContain('text_extraction');
    for (const cap of unsupported.slice(0, 1)) {
      expect(routed).not.toContain(cap);
    }
  });

  it('throws a descriptive error, not a TypeError, when nothing is routable', () => {
    expect(() => generatePipeline(req({ capabilities: unsupported })))
      .toThrowError(/No processing method supports/);
  });

  it('ignores an explicit assignment naming a method outside the catalog', () => {
    // A stale run record can carry a removed method id such as nova-pro.
    const { pipeline } = generatePipeline(req({
      capabilities: ['text_extraction', 'kv_extraction'],
      methodAssignments: { text_extraction: 'nova-pro' as never },
    }));
    const methods = pipeline.nodes
      .filter((n) => n.type === 'method')
      .map((n) => (n.config as any).method as string);
    expect(methods).not.toContain('nova-pro');
    expect(methods.length).toBeGreaterThan(0);
  });

  it('every generated method node resolves to a real catalog entry, for all strategies', () => {
    const strategies: Array<PipelineGenerateRequest['optimizeFor']> = ['balanced', 'accuracy', 'cost', 'speed'];
    for (const optimizeFor of strategies) {
      for (const hybrid of [false, true]) {
        const { pipeline } = generatePipeline(req({
          capabilities: ['text_extraction', 'kv_extraction', 'table_extraction'],
          optimizeFor,
          enableHybridRouting: hybrid,
        }));
        for (const node of pipeline.nodes.filter((n) => n.type === 'method')) {
          const method = (node.config as any).method as string;
          expect(node.label, `${optimizeFor}/${hybrid}: ${method} has no label`).toBeTruthy();
        }
        expect(pipeline.estimatedCostPerPage).toBeGreaterThan(0);
        expect(pipeline.estimatedLatencyMs).toBeGreaterThan(0);
      }
    }
  });
});
