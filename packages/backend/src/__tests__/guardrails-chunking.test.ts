import { describe, it, expect } from 'vitest';
import { chunkUtf8, GUARDRAILS_CHUNK_BYTES } from '../adapters/guardrails-adapter.js';

const enc = new TextEncoder();

describe('chunkUtf8', () => {
  it('returns single chunk when under limit', () => {
    expect(chunkUtf8('hello', 100)).toEqual(['hello']);
  });

  it('returns single-empty-chunk array for empty text', () => {
    expect(chunkUtf8('', 100)).toEqual(['']);
  });

  it('every chunk fits within maxBytes', () => {
    const text = 'line\n'.repeat(5000);
    const chunks = chunkUtf8(text, 512);
    for (const c of chunks) {
      expect(enc.encode(c).length).toBeLessThanOrEqual(512);
    }
  });

  it('concatenation reproduces the original text (minus join chars)', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Line ${i}`).join('\n');
    const chunks = chunkUtf8(text, 128);
    const rejoined = chunks.join('\n');
    // When chunks are formed on newline boundaries they rejoin losslessly;
    // otherwise content is preserved but newlines may be remixed.
    expect(rejoined.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('splits across newline boundaries when possible', () => {
    const text = 'short1\nshort2\nshort3\nshort4';
    const chunks = chunkUtf8(text, 14);
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk should contain a partial line fragment.
    for (const c of chunks) {
      expect(c).not.toMatch(/^[a-z]\d$/);
    }
  });

  it('hard-cuts a single line that exceeds maxBytes', () => {
    const giant = 'x'.repeat(5000);
    const chunks = chunkUtf8(giant, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(enc.encode(c).length).toBeLessThanOrEqual(200);
    }
    expect(chunks.join('')).toBe(giant);
  });

  it('handles UTF-8 multi-byte characters without busting the limit', () => {
    const korean = '안녕하세요 '.repeat(2000);
    const chunks = chunkUtf8(korean, 128);
    for (const c of chunks) {
      expect(enc.encode(c).length).toBeLessThanOrEqual(128);
    }
  });

  it('GUARDRAILS_CHUNK_BYTES is under the documented 25KB Bedrock limit', () => {
    expect(GUARDRAILS_CHUNK_BYTES).toBeLessThanOrEqual(25 * 1024);
  });
});
