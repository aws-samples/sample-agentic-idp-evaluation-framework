import { describe, it, expect } from 'vitest';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';

describe('calculateMaxTokens', () => {
  it('returns minimum 512 for small documents', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', false)).toBe(512);
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

  it('caps at 4096', () => {
    expect(calculateMaxTokens(50, 50, 'json', false)).toBe(4096);
  });

  it('json format uses 1.3x multiplier', () => {
    const yaml = calculateMaxTokens(5, 3, 'yaml', false);
    const json = calculateMaxTokens(5, 3, 'json', false);
    expect(json).toBeGreaterThan(yaml);
  });

  it('media capabilities get minimum 2048', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', true)).toBe(2048);
  });

  it('media scales with cap count', () => {
    expect(calculateMaxTokens(5, 1, 'yaml', true)).toBe(2500);
  });

  // Specific examples from the plan
  it('3 caps, 1 page, yaml -> 750', () => {
    expect(calculateMaxTokens(3, 1, 'yaml', false)).toBe(750);
  });

  it('5 caps, 2 pages, yaml -> 1300', () => {
    expect(calculateMaxTokens(5, 2, 'yaml', false)).toBe(1300);
  });

  it('15 caps, 10 pages, json -> 4096 (capped)', () => {
    expect(calculateMaxTokens(15, 10, 'json', false)).toBe(4096);
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
