import { describe, it, expect } from 'vitest';
import { previewOutputCapForTest as previewOutputCap } from '../routes/preview.js';

/**
 * Preview runs every method in parallel and the user waits on the slowest one, so
 * this cap is what stops a runaway generation (one method once hit the model
 * ceiling and took 161s). But a flat cap truncates real multi-page documents, so
 * it has to scale.
 */
describe('previewOutputCap', () => {
  /*
   * Asserted as PROPERTIES, not literals.
   *
   * The previous version pinned exact numbers (5_700, 2_700) derived from the
   * constants, so it broke the moment the constants were corrected while telling us
   * nothing about whether the new values were right. The properties below are what
   * actually has to hold: enough room for real structured output, monotonic in both
   * inputs, and bounded.
   */
  it('fits a realistic single-page structured request', () => {
    /*
     * This is the case that was failing in production. Measured on one dense page:
     * table_extraction alone emitted ~3,900 tokens of HTML and bounding_box ~2,600
     * of per-cell boxes, so 2 capabilities need ~6,500 — the old cap gave 4,200 and
     * the response was cut off mid-value, then reported as a success.
     */
    expect(previewOutputCap(2, 1)).toBeGreaterThanOrEqual(6_500);
    // A single structured capability needs several thousand tokens on its own.
    expect(previewOutputCap(1, 1)).toBeGreaterThanOrEqual(4_000);
  });

  it('scales up with page count so a long document is not truncated', () => {
    expect(previewOutputCap(3, 10)).toBeGreaterThan(previewOutputCap(3, 1));
    // Both may be clamped at the ceiling, so compare below it.
    expect(previewOutputCap(1, 10)).toBeGreaterThan(previewOutputCap(1, 2));
  });

  it('gives a 30-page document room well beyond a flat 4096 cap', () => {
    // The flat cap would have truncated this mid-table.
    expect(previewOutputCap(3, 30)).toBeGreaterThanOrEqual(20_000);
  });

  it('scales with capability count too', () => {
    expect(previewOutputCap(8, 5)).toBeGreaterThan(previewOutputCap(2, 5));
  });

  it('still bounds runaways: never exceeds the preview ceiling', () => {
    expect(previewOutputCap(50, 500)).toBe(32_000);
    expect(previewOutputCap(15, 100)).toBe(32_000);
  });

  it('stays below the full-run model maximum, so preview is always cheaper', () => {
    expect(previewOutputCap(50, 500)).toBeLessThan(64_000);
  });
});
