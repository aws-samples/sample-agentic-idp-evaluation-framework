import { describe, it, expect } from 'vitest';
import { parseClassification, summarizeClassification } from '../services/page-classifier.js';

/**
 * The Page Classifier node was drawn on the canvas and described as
 * "Route by content type" but never executed. Now that it runs for real, its
 * parsing has to be defensive: the model's JSON is the only thing standing
 * between a routing decision and a crashed pipeline.
 */
describe('parseClassification', () => {
  it('parses a well-formed array', () => {
    const out = parseClassification('[{"page":1,"contentType":"table","confidence":0.9}]', 3);
    expect(out).toEqual([{ page: 1, contentType: 'table', confidence: 0.9 }]);
  });

  it('strips code fences the model adds anyway', () => {
    const out = parseClassification('```json\n[{"page":1,"contentType":"form","confidence":0.8}]\n```', 1);
    expect(out).toHaveLength(1);
    expect(out[0].contentType).toBe('form');
  });

  it('tolerates prose around the array', () => {
    const out = parseClassification('Here you go:\n[{"page":2,"contentType":"image","confidence":0.7}]\nDone.', 5);
    expect(out).toEqual([{ page: 2, contentType: 'image', confidence: 0.7 }]);
  });

  it('returns empty for unparseable output rather than throwing', () => {
    expect(parseClassification('not json', 3)).toEqual([]);
    expect(parseClassification('', 3)).toEqual([]);
    expect(parseClassification('[{broken', 3)).toEqual([]);
  });

  it('drops pages outside the document range', () => {
    const out = parseClassification(
      '[{"page":1,"contentType":"table","confidence":0.9},{"page":99,"contentType":"table","confidence":0.9}]',
      2,
    );
    expect(out.map((p) => p.page)).toEqual([1]);
  });

  it('drops unknown content types instead of routing on garbage', () => {
    const out = parseClassification('[{"page":1,"contentType":"spreadsheet","confidence":0.9}]', 1);
    expect(out).toEqual([]);
  });

  it('deduplicates repeated pages', () => {
    const out = parseClassification(
      '[{"page":1,"contentType":"table","confidence":0.9},{"page":1,"contentType":"form","confidence":0.5}]',
      1,
    );
    expect(out).toHaveLength(1);
    expect(out[0].contentType).toBe('table');
  });

  it('defaults and clamps confidence', () => {
    const out = parseClassification(
      '[{"page":1,"contentType":"table"},{"page":2,"contentType":"form","confidence":5}]',
      2,
    );
    expect(out[0].confidence).toBe(0.5);
    expect(out[1].confidence).toBe(1);
  });

  it('sorts by page number', () => {
    const out = parseClassification(
      '[{"page":3,"contentType":"table","confidence":0.9},{"page":1,"contentType":"form","confidence":0.9}]',
      3,
    );
    expect(out.map((p) => p.page)).toEqual([1, 3]);
  });
});

describe('summarizeClassification', () => {
  it('counts pages per content type', () => {
    const s = summarizeClassification([
      { page: 1, contentType: 'table', confidence: 0.9 },
      { page: 2, contentType: 'table', confidence: 0.9 },
      { page: 3, contentType: 'text-only', confidence: 0.8 },
    ]);
    expect(s).toBe('2 table, 1 text-only');
  });

  it('is empty when nothing was classified', () => {
    expect(summarizeClassification([])).toBe('');
  });
});
