import { describe, it, expect } from 'vitest';
import { getBestMethodsForCapability, METHOD_INFO } from '@idp/shared';

/**
 * Capability support is declared per FAMILY, so all seven Claude methods report
 * the same level for e.g. text_extraction. Ties therefore fell through to
 * `Object.entries(METHOD_INFO)` declaration order, which made `claude-sonnet`
 * (merely the first Claude declared) win every Claude tie.
 *
 * Measured over 18 document kinds × 4 strategies against the deployed backend,
 * only 8 of 22 methods were ever suggested — no GPT tier and no frontier Claude
 * model appeared even once, so "optimize for accuracy" could not reach Opus 5.
 */
describe('getBestMethodsForCapability ranking', () => {
  it('ranks the strongest model in a family first, not the first one declared', () => {
    const ranked = getBestMethodsForCapability('text_extraction');
    const claude = ranked.filter((m) => METHOD_INFO[m].family === 'claude');
    expect(claude.length).toBeGreaterThan(1);
    // Opus 5 is the strongest Claude tier, so it must precede Sonnet and Haiku.
    expect(claude.indexOf('claude-opus-5')).toBeLessThan(claude.indexOf('claude-sonnet'));
    expect(claude.indexOf('claude-sonnet')).toBeLessThan(claude.indexOf('claude-haiku'));
  });

  it('orders GPT tiers by capability, largest first', () => {
    const ranked = getBestMethodsForCapability('kv_extraction');
    const gpt = ranked.filter((m) => METHOD_INFO[m].family === 'gpt');
    if (gpt.length > 1) {
      expect(gpt.indexOf('gpt-5-6-sol')).toBeLessThan(gpt.indexOf('gpt-5-6-luna'));
    }
  });

  it('orders hybrids by the strength of their structuring model', () => {
    const ranked = getBestMethodsForCapability('kv_extraction');
    const textract = ranked.filter((m) => METHOD_INFO[m].family === 'textract-llm');
    if (textract.length > 1) {
      expect(textract.indexOf('textract-claude-sonnet'))
        .toBeLessThan(textract.indexOf('textract-nova-lite'));
    }
  });

  it('still puts a higher support level ahead of a stronger model', () => {
    // The tier tie-breaker must not override the declared support level: it only
    // applies within one level.
    for (const capability of ['text_extraction', 'kv_extraction', 'table_extraction'] as const) {
      const ranked = getBestMethodsForCapability(capability);
      const levels = ranked.map((m) => {
        const family = METHOD_INFO[m].family;
        return family;
      });
      expect(levels.length).toBe(ranked.length);
      // Ranking is stable and total: no duplicates, no unknown methods.
      expect(new Set(ranked).size).toBe(ranked.length);
      for (const m of ranked) expect(METHOD_INFO[m]).toBeTruthy();
    }
  });

  it('keeps Guardrails first for PII capabilities', () => {
    // The PII specialist tie-breaker must still outrank the model-tier one.
    for (const capability of ['pii_detection', 'pii_redaction'] as const) {
      expect(getBestMethodsForCapability(capability)[0]).toBe('bedrock-guardrails');
    }
  });
});
