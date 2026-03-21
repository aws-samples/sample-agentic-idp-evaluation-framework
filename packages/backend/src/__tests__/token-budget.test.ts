import { describe, it, expect } from 'vitest';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';

describe('calculateMaxTokens', () => {
  // New formula: 1000/cap + 800/page, min 4096, max 16384
  it('returns minimum 4096 for small documents', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', false)).toBe(4096);
  });

  it('scales with capability count', () => {
    const tokens3 = calculateMaxTokens(3, 1, 'yaml', false);
    const tokens10 = calculateMaxTokens(10, 1, 'yaml', false);
    expect(tokens10).toBeGreaterThan(tokens3);
  });

  it('scales with page count', () => {
    const tokens1 = calculateMaxTokens(3, 1, 'yaml', false);
    const tokens5 = calculateMaxTokens(3, 5, 'yaml', false);
    expect(tokens5).toBeGreaterThan(tokens1);
  });

  it('caps at 16384', () => {
    expect(calculateMaxTokens(50, 50, 'json', false)).toBe(16384);
  });

  it('json format uses 1.3x multiplier', () => {
    const yaml = calculateMaxTokens(5, 3, 'yaml', false);
    const json = calculateMaxTokens(5, 3, 'json', false);
    expect(json).toBeGreaterThan(yaml);
  });

  it('media capabilities get minimum 4096', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', true)).toBe(4096);
  });

  it('media scales with cap count', () => {
    expect(calculateMaxTokens(5, 1, 'yaml', true)).toBe(5000);
  });

  // Real-world examples
  it('2 caps, 6 pages, yaml -> 6800 (Korean invoice)', () => {
    // 1000*2 + 800*6 = 6800
    expect(calculateMaxTokens(2, 6, 'yaml', false)).toBe(6800);
  });

  it('3 caps, 1 page, yaml -> 4096 (min)', () => {
    // 1000*3 + 800*1 = 3800 → min 4096
    expect(calculateMaxTokens(3, 1, 'yaml', false)).toBe(4096);
  });

  it('5 caps, 2 pages, yaml -> 6600', () => {
    // 1000*5 + 800*2 = 6600
    expect(calculateMaxTokens(5, 2, 'yaml', false)).toBe(6600);
  });

  it('15 caps, 10 pages, json -> 16384 (capped)', () => {
    // (1000*15 + 800*10)*1.3 = 29900 → cap 16384
    expect(calculateMaxTokens(15, 10, 'json', false)).toBe(16384);
  });
});

describe('isMediaCapability', () => {
  it('identifies media capabilities', () => {
    expect(isMediaCapability('video_summarization')).toBe(true);
    expect(isMediaCapability('audio_transcription')).toBe(true);
    expect(isMediaCapability('content_moderation')).toBe(true);
  });

  it('rejects non-media capabilities', () => {
    expect(isMediaCapability('text_extraction')).toBe(false);
    expect(isMediaCapability('table_extraction')).toBe(false);
  });
});
