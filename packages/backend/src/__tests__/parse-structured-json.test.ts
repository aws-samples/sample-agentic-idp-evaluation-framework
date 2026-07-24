import { describe, it, expect } from 'vitest';
import { parseStructuredJsonResults } from '../adapters/extraction-shared.js';

/**
 * The BDA+LLM and Textract+LLM adapters each carried a private copy of this
 * parser and the copies had drifted (different default confidence). Now there is
 * one implementation, so it needs real coverage.
 */
describe('parseStructuredJsonResults', () => {
  it('parses well-formed JSON keyed by capability', () => {
    const raw = JSON.stringify({
      text_extraction: { data: 'Invoice 4242', confidence: 0.91, format: 'text' },
    });
    const out = parseStructuredJsonResults(raw, ['text_extraction']);
    expect(out.text_extraction.data).toBe('Invoice 4242');
    expect(out.text_extraction.confidence).toBe(0.91);
    expect(out.text_extraction.format).toBe('text');
  });

  it('strips markdown code fences the model adds despite instructions', () => {
    const raw = '```json\n{"text_extraction":{"data":"hello"}}\n```';
    const out = parseStructuredJsonResults(raw, ['text_extraction']);
    expect(out.text_extraction.data).toBe('hello');
  });

  it('falls back to raw text at low confidence when JSON is invalid', () => {
    const out = parseStructuredJsonResults('not json at all', ['text_extraction']);
    expect(out.text_extraction.data).toBe('not json at all');
    expect(out.text_extraction.confidence).toBe(0.5);
    expect(out.text_extraction.format).toBe('text');
  });

  it('treats null content_moderation data as "nothing flagged", not missing', () => {
    const raw = JSON.stringify({ content_moderation: { data: null } });
    const out = parseStructuredJsonResults(raw, ['content_moderation']);
    expect(out.content_moderation.data).toEqual({ safe: true, flags: [] });
    expect(out.content_moderation.confidence).toBe(0.95);
  });

  it('does not apply the safe-null rule to other capabilities', () => {
    const raw = JSON.stringify({ text_extraction: { data: null } });
    const out = parseStructuredJsonResults(raw, ['text_extraction']);
    expect(out.text_extraction.data).toBeNull();
  });

  it('honors the caller-supplied fallback confidence', () => {
    const raw = JSON.stringify({ text_extraction: { data: 'x' } });
    expect(parseStructuredJsonResults(raw, ['text_extraction'], 0.8).text_extraction.confidence).toBe(0.8);
    expect(parseStructuredJsonResults(raw, ['text_extraction'], 0.7).text_extraction.confidence).toBe(0.7);
  });

  it('returns an entry for every requested capability, even if absent', () => {
    const raw = JSON.stringify({ text_extraction: { data: 'x' } });
    const out = parseStructuredJsonResults(raw, ['text_extraction', 'table_extraction']);
    expect(Object.keys(out).sort()).toEqual(['table_extraction', 'text_extraction']);
  });
});
