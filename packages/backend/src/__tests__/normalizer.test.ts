import { describe, it, expect } from 'vitest';
import { normalizeOutput } from '../services/normalizer.js';
import type { AdapterOutput } from '../adapters/stream-adapter.js';

describe('normalizeOutput', () => {
  it('normalizes text extraction', () => {
    const output: AdapterOutput = {
      results: {
        text_extraction: { capability: 'text_extraction', data: 'Hello world', confidence: 0.9, format: 'text' },
      },
      rawOutput: 'raw',
      latencyMs: 100,
    };

    const pages = normalizeOutput(output, 'claude-haiku', 1);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toBe('Hello world');
    expect(pages[0].pageNumber).toBe(1);
  });

  it('normalizes kv extraction from object', () => {
    const output: AdapterOutput = {
      results: {
        kv_extraction: { capability: 'kv_extraction', data: { name: 'John', age: '30' }, confidence: 0.8, format: 'json' },
      },
      rawOutput: '',
      latencyMs: 100,
    };

    const pages = normalizeOutput(output, 'claude-haiku', 1);
    expect(pages[0].kvPairs).toHaveLength(2);
    expect(pages[0].kvPairs[0]).toEqual({ key: 'name', value: 'John', confidence: 0.8 });
  });

  it('normalizes entity extraction from array', () => {
    const output: AdapterOutput = {
      results: {
        entity_extraction: {
          capability: 'entity_extraction',
          data: [{ type: 'person', value: 'John' }, { type: 'date', value: '2026-01-01' }],
          confidence: 0.85,
          format: 'json',
        },
      },
      rawOutput: '',
      latencyMs: 100,
    };

    const pages = normalizeOutput(output, 'nova-lite', 1);
    expect(pages[0].entities).toHaveLength(2);
    expect(pages[0].entities[0].type).toBe('person');
  });

  it('stores unknown capabilities in metadata', () => {
    const output: AdapterOutput = {
      results: {
        bounding_box: { capability: 'bounding_box', data: [{ x: 0, y: 0 }], confidence: 0.7, format: 'json' },
      },
      rawOutput: '',
      latencyMs: 100,
    };

    const pages = normalizeOutput(output, 'nova-lite', 1);
    expect(pages[0].metadata.bounding_box).toBeDefined();
  });

  it('uses rawOutput as fallback text', () => {
    const output: AdapterOutput = {
      results: {},
      rawOutput: 'fallback text content',
      latencyMs: 100,
    };

    const pages = normalizeOutput(output, 'bda-standard', 1);
    expect(pages[0].text).toBe('fallback text content');
  });

  it('creates multiple pages', () => {
    const output: AdapterOutput = {
      results: {
        text_extraction: { capability: 'text_extraction', data: 'content', confidence: 0.9, format: 'text' },
      },
      rawOutput: '',
      latencyMs: 100,
    };

    const pages = normalizeOutput(output, 'claude-sonnet', 3);
    expect(pages).toHaveLength(3);
    expect(pages[2].pageNumber).toBe(3);
  });
});
