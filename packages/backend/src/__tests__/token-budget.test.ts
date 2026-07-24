import { describe, it, expect } from 'vitest';
import {
  calculateMaxTokens,
  clampToCeiling,
  isMediaCapability,
  modelMaxOutputTokens,
} from '../services/token-budget.js';

describe('calculateMaxTokens', () => {
  // Formula: 4000/cap + 2000/page (json ×1.3), min 16384, max 64000.
  // Budgets are deliberately generous: maxTokens is an upper bound and you are
  // billed for tokens actually generated, so headroom costs nothing on short
  // answers but prevents mid-table/mid-JSON truncation on dense documents.
  it('returns the 16384 minimum for small documents', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', false)).toBe(16384);
  });

  it('scales with capability count', () => {
    const tokens3 = calculateMaxTokens(3, 1, 'yaml', false);
    const tokens10 = calculateMaxTokens(10, 1, 'yaml', false);
    expect(tokens10).toBeGreaterThan(tokens3);
  });

  it('scales with page count', () => {
    const tokens1 = calculateMaxTokens(3, 1, 'yaml', false);
    const tokens30 = calculateMaxTokens(3, 30, 'yaml', false);
    expect(tokens30).toBeGreaterThan(tokens1);
  });

  it('caps at model max (64000)', () => {
    expect(calculateMaxTokens(50, 50, 'json', false)).toBe(64000);
  });

  it('json format uses 1.3x multiplier', () => {
    const yaml = calculateMaxTokens(5, 10, 'yaml', false);
    const json = calculateMaxTokens(5, 10, 'json', false);
    expect(json).toBeGreaterThan(yaml);
  });

  it('media capabilities get at least 32768', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', true)).toBe(32768);
  });

  it('media scales with cap count', () => {
    expect(calculateMaxTokens(5, 1, 'yaml', true)).toBe(40000);
  });

  it('media caps at model max', () => {
    expect(calculateMaxTokens(20, 1, 'yaml', true)).toBe(64000);
  });

  // Real-world examples
  it('2 caps, 6 pages, yaml -> 20000 (Korean invoice)', () => {
    // 4000*2 + 2000*6 = 20000
    expect(calculateMaxTokens(2, 6, 'yaml', false)).toBe(20000);
  });

  it('3 caps, 1 page, yaml -> 16384 (min floor applies)', () => {
    // 4000*3 + 2000*1 = 14000 → raised to the 16384 floor
    expect(calculateMaxTokens(3, 1, 'yaml', false)).toBe(16384);
  });

  it('5 caps, 2 pages, yaml -> 24000', () => {
    // 4000*5 + 2000*2 = 24000
    expect(calculateMaxTokens(5, 2, 'yaml', false)).toBe(24000);
  });

  it('15 caps, 10 pages, json -> clamped to the 64000 cap', () => {
    // (4000*15 + 2000*10)*1.3 = 104000 → clamped to 64000
    expect(calculateMaxTokens(15, 10, 'json', false)).toBe(64000);
  });
});

describe('per-model output ceilings', () => {
  // Every model in the current catalog accepts 64000 output tokens, so no
  // clamp entries are needed today. These tests pin the clamp MECHANISM, which
  // exists because a model with a lower ceiling hard-fails with
  // "The maximum tokens you requested exceeds the model limit of N"
  // (Nova 1 Pro did exactly that at 10000 before it was removed).
  it('defaults to 64000 for every model we route to', () => {
    expect(modelMaxOutputTokens('us.anthropic.claude-opus-5')).toBe(64_000);
    expect(modelMaxOutputTokens('us.amazon.nova-2-lite-v1:0')).toBe(64_000);
    expect(modelMaxOutputTokens('openai.gpt-5.6-sol')).toBe(64_000);
    expect(modelMaxOutputTokens(undefined)).toBe(64_000);
  });

  it('clamps a large request down to the ceiling', () => {
    expect(clampToCeiling(50_000, 16_384, 10_000)).toBe(10_000);
  });

  it('clamps the FLOOR down to the ceiling too', () => {
    // The generous 16384 floor must never push a constrained model past its
    // hard limit — that is what broke Nova 1 Pro (limit 10000).
    expect(clampToCeiling(1_000, 16_384, 10_000)).toBe(10_000);
  });

  it('raises a small request up to the floor when the ceiling allows', () => {
    expect(clampToCeiling(1_000, 16_384, 64_000)).toBe(16_384);
  });

  it('passes through a value between floor and ceiling', () => {
    expect(clampToCeiling(24_000, 16_384, 64_000)).toBe(24_000);
  });

  it('gives Claude models the full budget', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', false, 'us.anthropic.claude-opus-5')).toBe(16_384);
    expect(calculateMaxTokens(15, 10, 'json', false, 'us.anthropic.claude-opus-5')).toBe(64_000);
  });

  it('gives Nova 2 Lite the full budget', () => {
    expect(calculateMaxTokens(5, 2, 'yaml', false, 'us.amazon.nova-2-lite-v1:0')).toBe(24_000);
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
