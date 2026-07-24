import { describe, it, expect } from 'vitest';
import { isModelBackedCapability, filterModelBackedCapabilities, CAPABILITY_INFO } from '@idp/shared';
import { buildSystemPrompt, CAPABILITY_GUIDANCE } from '../adapters/extraction-shared.js';
import { applyOutputCap } from '../services/token-budget.js';

/**
 * pdf_conversion and format_standardization declare no method support because
 * they are pipeline preprocessing, not model tasks. They were still being
 * auto-selected and injected into every LLM prompt, where they fell through to
 * the generic "Extract <name> data." instruction and asked models for output
 * that cannot exist.
 */
describe('preprocessing capabilities are not model tasks', () => {
  const PREPROCESSING = ['pdf_conversion', 'format_standardization'] as const;

  it('identifies preprocessing capabilities as not model-backed', () => {
    for (const cap of PREPROCESSING) {
      expect(isModelBackedCapability(cap)).toBe(false);
    }
  });

  it('identifies real extraction capabilities as model-backed', () => {
    for (const cap of ['text_extraction', 'table_extraction', 'kv_extraction', 'pii_detection'] as const) {
      expect(isModelBackedCapability(cap)).toBe(true);
    }
  });

  it('filters preprocessing out of a capability list, preserving order', () => {
    const filtered = filterModelBackedCapabilities([
      'table_extraction',
      'pdf_conversion',
      'kv_extraction',
    ] as const);
    expect(filtered).toEqual(['table_extraction', 'kv_extraction']);
  });

  it('keeps preprocessing capabilities out of the model prompt', () => {
    const prompt = buildSystemPrompt(['table_extraction', 'pdf_conversion', 'kv_extraction']);
    expect(prompt).toContain('table_extraction');
    expect(prompt).toContain('kv_extraction');
    expect(prompt).not.toContain('pdf_conversion');
    // The meaningless fallback instruction must not appear either.
    expect(prompt).not.toContain('Extract pdf conversion data');
  });

  it('does not produce an empty capability list if ONLY preprocessing was asked for', () => {
    // Degenerate input should still yield a usable prompt rather than one with
    // no capabilities at all.
    const prompt = buildSystemPrompt(['pdf_conversion']);
    expect(prompt).toContain('pdf_conversion');
  });

  it('every model-backed capability has explicit guidance or a real support matrix', () => {
    // Guards against a new capability silently relying on the generic fallback.
    for (const [id, info] of Object.entries(CAPABILITY_INFO)) {
      if (!isModelBackedCapability(id as never)) continue;
      const hasGuidance = !!CAPABILITY_GUIDANCE[id];
      const hasSupport = Object.values(info.support ?? {}).some((l) => l && l !== 'none');
      expect(hasGuidance || hasSupport).toBe(true);
    }
  });
});

/**
 * Preview runs every method in parallel and the user waits on the slowest one.
 * A real document once drove Nova 2 Lite to the 16384-token output ceiling and
 * a 161s response, versus ~5s normally.
 */
describe('applyOutputCap', () => {
  it('caps a generous budget down for interactive preview', () => {
    expect(applyOutputCap(16384, 4096)).toBe(4096);
  });

  it('leaves the budget untouched when no cap is given', () => {
    expect(applyOutputCap(16384, undefined)).toBe(16384);
    expect(applyOutputCap(16384, 0)).toBe(16384);
  });

  it('never raises a budget above what was computed', () => {
    expect(applyOutputCap(2048, 4096)).toBe(2048);
  });
});
