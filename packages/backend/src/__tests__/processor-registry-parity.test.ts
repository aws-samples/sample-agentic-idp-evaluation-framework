import { describe, it, expect } from 'vitest';
import { METHODS, METHOD_INFO, type ProcessingMethod } from '@idp/shared';
import { PROCESSOR_FACTORY_FOR_TEST as PREVIEW_REGISTRY } from '../routes/preview.js';
import { PROCESSOR_MAP_FOR_TEST as PIPELINE_REGISTRY } from '../routes/pipeline.js';
import { PROCESSOR_MAP_FOR_TEST as PROCESS_REGISTRY } from '../routes/process.js';

/**
 * The three routes each keep their own processor registry. When they drift, the
 * failure is silent and confusing for users: /preview happily offers a method,
 * then executing the generated pipeline dies with
 * "No processor for method: <x>".
 *
 * That is exactly what happened for claude-opus-4-8 / claude-opus-4-7 /
 * claude-sonnet-5 and all four GPT tiers — present in preview + process,
 * missing from pipeline. These tests pin the registries together.
 */

// Methods that legitimately have no standalone processor.
const NO_PROCESSOR: ReadonlySet<string> = new Set([
  'nova-embeddings', // embeddings model, not an extraction processor
]);

const executableMethods = (METHODS as readonly ProcessingMethod[]).filter(
  (m) => !NO_PROCESSOR.has(m),
);

describe('processor registry parity', () => {
  it('every executable method has a processor in all three registries', () => {
    const missing: Record<string, string[]> = {};
    for (const method of executableMethods) {
      const gaps: string[] = [];
      if (!PREVIEW_REGISTRY[method]) gaps.push('preview');
      if (!PIPELINE_REGISTRY[method]) gaps.push('pipeline');
      if (!PROCESS_REGISTRY[method]) gaps.push('process');
      if (gaps.length) missing[method] = gaps;
    }
    expect(missing).toEqual({});
  });

  it('pipeline can execute anything preview advertises', () => {
    const previewOnly = Object.keys(PREVIEW_REGISTRY).filter(
      (m) => !PIPELINE_REGISTRY[m as ProcessingMethod],
    );
    expect(previewOnly).toEqual([]);
  });

  it('registries contain no methods missing from METHOD_INFO', () => {
    for (const registry of [PREVIEW_REGISTRY, PIPELINE_REGISTRY, PROCESS_REGISTRY]) {
      for (const method of Object.keys(registry)) {
        expect(METHOD_INFO[method as ProcessingMethod]).toBeDefined();
      }
    }
  });

  it('claude-opus-5 is executable end to end', () => {
    expect(METHOD_INFO['claude-opus-5'].modelId).toBe('us.anthropic.claude-opus-5');
    expect(PREVIEW_REGISTRY['claude-opus-5']).toBeDefined();
    expect(PIPELINE_REGISTRY['claude-opus-5']).toBeDefined();
    expect(PROCESS_REGISTRY['claude-opus-5']).toBeDefined();
  });
});

describe('model ids', () => {
  it('no method points at a non-existent preview model', () => {
    // us.amazon.nova-2-pro-preview-20251202-v1:0 was configured but is not
    // resolvable in any region (Converse: ResourceNotFoundException), so every
    // nova-pro run failed. Nova 1 Pro has since been dropped from the catalog
    // entirely; guard against reintroducing either id.
    for (const method of METHODS as readonly ProcessingMethod[]) {
      expect(METHOD_INFO[method].modelId).not.toContain('nova-2-pro-preview');
      expect(METHOD_INFO[method].modelId).not.toBe('us.amazon.nova-pro-v1:0');
    }
  });

  it('Nova is represented only by Nova 2 Lite', () => {
    const novaMethods = (METHODS as readonly ProcessingMethod[]).filter(
      (m) => METHOD_INFO[m].family === 'nova',
    );
    expect(novaMethods).toEqual(['nova-lite']);
  });
});
