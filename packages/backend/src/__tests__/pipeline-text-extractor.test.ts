import { describe, it, expect } from 'vitest';
import type { ProcessorResult } from '@idp/shared';
import {
  extractUpstreamText,
  combineUpstreamText,
} from '../services/pipeline-text-extractor.js';

function mkResult(results: Record<string, unknown>, rawOutput?: string): ProcessorResult {
  const built: Record<string, any> = {};
  for (const [k, v] of Object.entries(results)) {
    built[k] = { capability: k, data: v, confidence: 0.9, format: 'text' };
  }
  return {
    method: 'claude-sonnet',
    status: 'complete',
    results: built as any,
    metrics: { latencyMs: 0, cost: 0 },
    ...(rawOutput !== undefined ? { rawOutput } : {}),
  };
}

describe('extractUpstreamText', () => {
  it('returns empty string for null/undefined', () => {
    expect(extractUpstreamText(null)).toBe('');
    expect(extractUpstreamText(undefined)).toBe('');
  });

  it('prefers document_summarization over other capabilities', () => {
    const r = mkResult({
      kv_extraction: { name: 'Bob' },
      document_summarization: 'The summary text.',
      text_extraction: 'All of the text.',
    });
    expect(extractUpstreamText(r)).toBe('The summary text.');
  });

  it('falls back to text_extraction when document_summarization is absent', () => {
    const r = mkResult({
      text_extraction: 'All of the text.',
      kv_extraction: { name: 'Bob' },
    });
    expect(extractUpstreamText(r)).toBe('All of the text.');
  });

  it('falls back to text_extraction', () => {
    const r = mkResult({ text_extraction: 'Raw text body.' });
    expect(extractUpstreamText(r)).toBe('Raw text body.');
  });

  it('stringifies kv_extraction object', () => {
    const r = mkResult({ kv_extraction: { name: 'Alice', age: '30' } });
    expect(extractUpstreamText(r)).toBe(JSON.stringify({ name: 'Alice', age: '30' }));
  });

  it('stringifies table_extraction array', () => {
    const r = mkResult({ table_extraction: [{ a: 1 }, { a: 2 }] });
    expect(extractUpstreamText(r)).toBe(JSON.stringify([{ a: 1 }, { a: 2 }]));
  });

  it('falls back to any capability with data when no preferred ones match', () => {
    const r = mkResult({ bounding_box: [{ x: 1, y: 2 }] });
    expect(extractUpstreamText(r)).toBe(JSON.stringify([{ x: 1, y: 2 }]));
  });

  it('falls back to rawOutput when results is empty', () => {
    const r: ProcessorResult = {
      method: 'claude-sonnet',
      status: 'complete',
      results: {},
      metrics: { latencyMs: 0, cost: 0 },
      rawOutput: 'only the raw output',
    };
    expect(extractUpstreamText(r)).toBe('only the raw output');
  });

  it('returns empty string when no data and no rawOutput', () => {
    const r: ProcessorResult = {
      method: 'claude-sonnet',
      status: 'complete',
      results: {},
      metrics: { latencyMs: 0, cost: 0 },
    };
    expect(extractUpstreamText(r)).toBe('');
  });

  it('skips capabilities whose data is null/undefined', () => {
    const r: ProcessorResult = {
      method: 'claude-sonnet',
      status: 'complete',
      results: {
        document_summarization: { capability: 'document_summarization', data: null as any, confidence: 0, format: 'text' },
        text_extraction: { capability: 'text_extraction', data: 'real text', confidence: 0.9, format: 'text' },
      },
      metrics: { latencyMs: 0, cost: 0 },
    };
    expect(extractUpstreamText(r)).toBe('real text');
  });
});

describe('combineUpstreamText', () => {
  it('joins non-empty results with double-newline', () => {
    const a = mkResult({ document_summarization: 'First.' });
    const b = mkResult({ text_extraction: 'Second.' });
    expect(combineUpstreamText([a, b])).toBe('First.\n\nSecond.');
  });

  it('skips undefined/empty entries', () => {
    const a = mkResult({ document_summarization: 'Only one.' });
    expect(combineUpstreamText([undefined, a, null])).toBe('Only one.');
  });

  it('returns empty string for all-empty', () => {
    expect(combineUpstreamText([undefined, null])).toBe('');
  });
});
