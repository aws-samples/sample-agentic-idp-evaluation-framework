import { describe, it, expect } from 'vitest';
import { aggregateResults, hasData, type MethodContribution } from '../services/aggregator.js';

/**
 * The pipeline canvas draws an Aggregator node with a strategy, but the executor
 * merged results with Object.assign — the method that finished LAST won,
 * regardless of the strategy the user was shown. These tests pin the real rules.
 */

function contribution(
  method: string,
  cap: string,
  data: unknown,
  confidence: number,
  latencyMs: number,
  cost: number,
): MethodContribution {
  return {
    method: method as MethodContribution['method'],
    results: { [cap]: { capability: cap, data, confidence, format: 'json' } as never },
    latencyMs,
    cost,
  };
}

describe('aggregateResults', () => {
  it('best-confidence picks the highest-confidence answer, not the last one', () => {
    const out = aggregateResults(
      [
        contribution('claude-opus-5', 'table_extraction', '<table>A</table>', 0.95, 12_000, 0.05),
        // Finishes last, so Object.assign would have let this win.
        contribution('nova-lite', 'table_extraction', '<table>B</table>', 0.60, 3_000, 0.002),
      ],
      'best-confidence',
    );
    expect(out.table_extraction.data).toBe('<table>A</table>');
    expect(out.table_extraction.sourceMethod).toBe('claude-opus-5');
    expect(out.table_extraction.alternativeMethods).toEqual(['nova-lite']);
  });

  it('best-cost picks the cheapest method', () => {
    const out = aggregateResults(
      [
        contribution('claude-opus-5', 'kv_extraction', { a: 1 }, 0.95, 12_000, 0.05),
        contribution('nova-lite', 'kv_extraction', { b: 2 }, 0.60, 3_000, 0.002),
      ],
      'best-cost',
    );
    expect(out.kv_extraction.sourceMethod).toBe('nova-lite');
  });

  it('best-speed picks the fastest method', () => {
    const out = aggregateResults(
      [
        contribution('claude-opus-5', 'kv_extraction', { a: 1 }, 0.99, 12_000, 0.05),
        contribution('nova-lite', 'kv_extraction', { b: 2 }, 0.60, 3_000, 0.002),
      ],
      'best-speed',
    );
    expect(out.kv_extraction.sourceMethod).toBe('nova-lite');
  });

  it('ignores empty answers even when their confidence is higher', () => {
    // A method that confidently returned nothing must not beat one that
    // actually extracted content.
    const out = aggregateResults(
      [
        contribution('claude-haiku', 'table_extraction', null, 0.99, 2_000, 0.001),
        contribution('claude-opus-5', 'table_extraction', '<table>real</table>', 0.70, 12_000, 0.05),
      ],
      'best-confidence',
    );
    expect(out.table_extraction.sourceMethod).toBe('claude-opus-5');
  });

  it('still returns an answer when every method came back empty', () => {
    const out = aggregateResults(
      [
        contribution('claude-haiku', 'table_extraction', null, 0.4, 2_000, 0.001),
        contribution('nova-lite', 'table_extraction', '', 0.3, 1_000, 0.001),
      ],
      'best-confidence',
    );
    expect(out.table_extraction).toBeDefined();
  });

  it('resolves each capability independently', () => {
    const fast: MethodContribution = {
      method: 'nova-lite' as never,
      results: {
        table_extraction: { capability: 'table_extraction', data: 'weak', confidence: 0.4, format: 'html' } as never,
        kv_extraction: { capability: 'kv_extraction', data: { good: true }, confidence: 0.97, format: 'json' } as never,
      },
      latencyMs: 3_000,
      cost: 0.002,
    };
    const slow: MethodContribution = {
      method: 'claude-opus-5' as never,
      results: {
        table_extraction: { capability: 'table_extraction', data: 'strong', confidence: 0.93, format: 'html' } as never,
        kv_extraction: { capability: 'kv_extraction', data: { meh: true }, confidence: 0.5, format: 'json' } as never,
      },
      latencyMs: 12_000,
      cost: 0.05,
    };
    const out = aggregateResults([fast, slow], 'best-confidence');
    expect(out.table_extraction.sourceMethod).toBe('claude-opus-5');
    expect(out.kv_extraction.sourceMethod).toBe('nova-lite');
  });

  it('keeps capabilities only one method produced', () => {
    const out = aggregateResults(
      [
        contribution('nova-lite', 'kv_extraction', { a: 1 }, 0.8, 3_000, 0.002),
        contribution('claude-opus-5', 'table_extraction', '<table/>', 0.9, 12_000, 0.05),
      ],
      'best-confidence',
    );
    expect(Object.keys(out).sort()).toEqual(['kv_extraction', 'table_extraction']);
  });

  it('handles a single contribution', () => {
    const out = aggregateResults([contribution('nova-lite', 'kv_extraction', { a: 1 }, 0.8, 3_000, 0.002)]);
    expect(out.kv_extraction.sourceMethod).toBe('nova-lite');
    expect(out.kv_extraction.alternativeMethods).toEqual([]);
  });

  it('handles no contributions', () => {
    expect(aggregateResults([])).toEqual({});
  });
});

describe('hasData', () => {
  it('rejects empty values', () => {
    for (const d of [null, undefined, '', '   ', [], {}]) {
      expect(hasData({ capability: 'x', data: d, confidence: 1, format: 'json' } as never)).toBe(false);
    }
  });

  it('accepts real content', () => {
    for (const d of ['text', ['a'], { k: 'v' }, 0, false]) {
      expect(hasData({ capability: 'x', data: d, confidence: 1, format: 'json' } as never)).toBe(true);
    }
  });
});
