import { describe, it, expect } from 'vitest';
import type { ProcessingMethod } from '@idp/shared';
import {
  METHODS,
  METHOD_INFO,
  TEXTRACT_PAGE_PRICING,
  TYPICAL_PAGE_TOKENS,
  estimateCostPerPage,
} from '@idp/shared';

/**
 * `estimatedCostPerPage` used to be 23 hand-written literals. When nine token
 * prices were corrected against the live Bedrock catalog, those literals silently
 * kept the old inputs — the Nova figures were derived from prices 2x too high — so
 * the field the cost ranking and every pre-run projection read was stale, and
 * nothing failed. It is now derived from `tokenPricing`; these tests pin the
 * properties that made the hand-written version wrong.
 */
describe('estimatedCostPerPage is derived, not hand-written', () => {
  it('every method matches the derivation from its own token prices', () => {
    for (const method of METHODS) {
      const info = METHOD_INFO[method];
      // BDA Custom bills at the custom-blueprint rate, which is a service price
      // and not a function of token prices — the one documented exception.
      if (method === 'bda-custom') continue;
      expect(info.estimatedCostPerPage, method).toBeCloseTo(
        estimateCostPerPage(info.family, info.tokenPricing),
        6,
      );
    }
  });

  it('a more expensive model is never estimated as cheaper within a family', () => {
    // The property the stale literals broke: ordering by estimate has to agree
    // with ordering by price, because the cost strategy sorts on the estimate.
    const byFamily = new Map<string, ProcessingMethod[]>();
    for (const method of METHODS) {
      // bda-custom is priced by its service tier, not by tokens (both BDA methods
      // report zero token pricing), so token prices cannot order it.
      if (method === 'bda-custom') continue;
      const family = METHOD_INFO[method].family;
      byFamily.set(family, [...(byFamily.get(family) ?? []), method]);
    }
    for (const [family, methods] of byFamily) {
      for (const a of methods) {
        for (const b of methods) {
          const pa = METHOD_INFO[a].tokenPricing;
          const pb = METHOD_INFO[b].tokenPricing;
          const aCheaper = pa.inputPer1MTokens <= pb.inputPer1MTokens
            && pa.outputPer1MTokens <= pb.outputPer1MTokens;
          if (!aCheaper) continue;
          expect(
            METHOD_INFO[a].estimatedCostPerPage,
            `${family}: ${a} priced <= ${b} but estimated higher`,
          ).toBeLessThanOrEqual(METHOD_INFO[b].estimatedCostPerPage);
        }
      }
    }
  });

  it('no billed method rounds to $0.0000', () => {
    // Nova Embeddings ($0.02/M in, no output) lands at $0.000044/page. Displaying
    // that as $0.0000 says "free" about something that bills — the bug this
    // rounding floor exists to prevent.
    for (const method of METHODS) {
      expect(METHOD_INFO[method].estimatedCostPerPage, method).toBeGreaterThan(0);
    }
  });

  it('hybrid families include their managed per-page service fee', () => {
    // The estimate must exceed the fee floor, or a hybrid could be ranked cheaper
    // than the OCR call it always makes.
    for (const method of METHODS) {
      const info = METHOD_INFO[method];
      if (info.family === 'textract-llm') {
        expect(info.estimatedCostPerPage, method)
          .toBeGreaterThan(TEXTRACT_PAGE_PRICING.detectText);
      }
      if (info.family === 'bda-llm') {
        expect(info.estimatedCostPerPage, method).toBeGreaterThan(0.01);
      }
    }
  });

  it('a Textract hybrid costs more than the same model used directly', () => {
    // Same model, plus an OCR stage, so it cannot be cheaper. This is the
    // cross-family consistency the per-family literals could not guarantee.
    const pairs: Array<[ProcessingMethod, ProcessingMethod]> = [
      ['textract-claude-sonnet', 'claude-sonnet'],
      ['textract-claude-haiku', 'claude-haiku'],
      ['textract-nova-lite', 'nova-lite'],
    ];
    for (const [hybrid, direct] of pairs) {
      expect(METHOD_INFO[hybrid].estimatedCostPerPage, `${hybrid} vs ${direct}`)
        .toBeGreaterThan(METHOD_INFO[direct].estimatedCostPerPage);
    }
  });

  it('the typical-page token shape is a plausible document page', () => {
    // Guards against someone "fixing" a ranking by inflating the workload rather
    // than the price. Live preview runs measured 1.8k-2.6k input per page.
    expect(TYPICAL_PAGE_TOKENS.input).toBeGreaterThanOrEqual(1_000);
    expect(TYPICAL_PAGE_TOKENS.input).toBeLessThanOrEqual(5_000);
    expect(TYPICAL_PAGE_TOKENS.output).toBeLessThan(TYPICAL_PAGE_TOKENS.input);
  });
});
