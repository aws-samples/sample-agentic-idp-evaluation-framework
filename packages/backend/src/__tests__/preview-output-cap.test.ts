import { describe, it, expect } from 'vitest';
import { previewOutputCapForTest as previewOutputCap } from '../routes/preview.js';

/**
 * Preview runs every method in parallel and the user waits on the slowest one, so
 * this cap is what stops a runaway generation (one method once hit the model
 * ceiling and took 161s). But a flat cap truncates real multi-page documents, so
 * it has to scale.
 */
describe('previewOutputCap', () => {
  it('gives a small single-page document a modest budget', () => {
    expect(previewOutputCap(3, 1)).toBe(5_700);
  });

  it('scales all the way down for a trivial request', () => {
    // No artificial floor: a one-capability single-page request needs little, and
    // a model that needs less simply emits less.
    expect(previewOutputCap(1, 1)).toBe(2_700);
  });

  it('scales up with page count so a long document is not truncated', () => {
    expect(previewOutputCap(3, 10)).toBeGreaterThan(previewOutputCap(3, 1));
    expect(previewOutputCap(3, 30)).toBeGreaterThan(previewOutputCap(3, 10));
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
