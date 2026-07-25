import { describe, it, expect } from 'vitest';
import { METHOD_INFO } from '@idp/shared';
import { calculateCost } from '../services/pricing.js';

/**
 * Cost is the number this whole tool exists to help people compare, so a wrong
 * one is worse than a missing one — it silently changes which method "wins".
 */
describe('calculateCost', () => {
  const usage = { inputTokens: 10_000, outputTokens: 2_000, totalTokens: 12_000 };

  /** Token-only cost, i.e. what the old implementation returned. */
  function tokenCost(method: keyof typeof METHOD_INFO) {
    const p = METHOD_INFO[method].tokenPricing;
    return (usage.inputTokens / 1e6) * p.inputPer1MTokens
      + (usage.outputTokens / 1e6) * p.outputPer1MTokens;
  }

  it('charges tokens only for single-stage LLM methods', () => {
    // Direct model calls have no per-page infrastructure stage to add.
    expect(calculateCost('claude-sonnet', 3, usage)).toBeCloseTo(tokenCost('claude-sonnet'), 4);
    expect(calculateCost('nova-lite', 3, usage)).toBeCloseTo(tokenCost('nova-lite'), 4);
    expect(calculateCost('gpt-5-6-luna', 3, usage)).toBeCloseTo(tokenCost('gpt-5-6-luna'), 4);
  });

  it('adds the Textract per-page fee on top of tokens for textract-llm', () => {
    const pages = 4;
    const cost = calculateCost('textract-nova-lite', pages, usage);
    // $0.0015/page Textract AnalyzeDocument + the LLM tokens.
    expect(cost).toBeCloseTo(tokenCost('textract-nova-lite') + 0.0015 * pages, 4);
    // The OCR stage bills regardless of how few tokens the LLM used.
    expect(cost).toBeGreaterThan(tokenCost('textract-nova-lite'));
  });

  it('adds the BDA per-page fee on top of tokens for bda-llm', () => {
    const pages = 2;
    const cost = calculateCost('bda-nova-lite', pages, usage);
    expect(cost).toBeCloseTo(tokenCost('bda-nova-lite') + 0.01 * pages, 4);
  });

  it('scales the per-page fee with page count', () => {
    const one = calculateCost('textract-claude-haiku', 1, usage);
    const ten = calculateCost('textract-claude-haiku', 10, usage);
    // Tokens are fixed here, so the whole delta is the 9 extra Textract pages.
    expect(ten - one).toBeCloseTo(0.0015 * 9, 4);
  });

  it('falls back to the per-page estimate when no tokens are reported', () => {
    // BDA Standard and Guardrails consume no LLM tokens.
    expect(calculateCost('bda-standard', 5)).toBeCloseTo(
      METHOD_INFO['bda-standard'].estimatedCostPerPage * 5, 4,
    );
    // Derived from the catalog, not restated: this assertion has already been
    // wrong twice as the Guardrails price moved ($0.0016 → $0.0501 → $0.0016 once
    // its Textract call was changed to plain OCR).
    expect(calculateCost('bedrock-guardrails', 1))
      .toBeCloseTo(METHOD_INFO['bedrock-guardrails'].estimatedCostPerPage, 4);
  });

  it('does not round a real cost down to zero', () => {
    // Nova Embeddings bills a fraction of a cent per page. Rounding to 3 decimals
    // reported $0.00 — "free" for a method that bills. Asserted against the
    // catalog value rather than a literal: the previous literal ($0.0005) went
    // stale the moment the per-page estimate became derived from token prices,
    // which is the same failure this whole change set exists to prevent.
    const cost = calculateCost('nova-embeddings', 1);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(METHOD_INFO['nova-embeddings'].estimatedCostPerPage, 4);
  });

  it('never returns a negative or NaN cost for any method', () => {
    for (const method of Object.keys(METHOD_INFO) as Array<keyof typeof METHOD_INFO>) {
      for (const u of [undefined, usage]) {
        const cost = calculateCost(method, 3, u);
        expect(Number.isFinite(cost), `${method} produced ${cost}`).toBe(true);
        expect(cost, `${method} produced ${cost}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('treats a zero or missing page count as one page', () => {
    // pageCount is estimated from the PDF and can come back 0 for formats the
    // estimator cannot parse; that must not zero out a per-page cost.
    expect(calculateCost('bda-standard', 0)).toBeCloseTo(
      METHOD_INFO['bda-standard'].estimatedCostPerPage, 4,
    );
  });
});
