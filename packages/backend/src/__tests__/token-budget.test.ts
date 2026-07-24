import { describe, it, expect } from 'vitest';
import {
  calculateMaxTokens,
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
  // Verified live against Bedrock Converse: Nova Pro rejects anything above
  // 10000 with "The maximum tokens you requested exceeds the model limit of
  // 10000", while every other model we route to accepts 64000. Without this
  // clamp the raised budgets broke nova-pro / textract-nova-pro outright.
  it('reports the Nova Pro 10000 ceiling', () => {
    expect(modelMaxOutputTokens('us.amazon.nova-pro-v1:0')).toBe(10_000);
  });

  it('defaults to 64000 for other models', () => {
    expect(modelMaxOutputTokens('us.anthropic.claude-opus-5')).toBe(64_000);
    expect(modelMaxOutputTokens('openai.gpt-5.6-sol')).toBe(64_000);
    expect(modelMaxOutputTokens(undefined)).toBe(64_000);
  });

  it('never exceeds the Nova Pro ceiling, even for large workloads', () => {
    expect(calculateMaxTokens(20, 50, 'json', false, 'us.amazon.nova-pro-v1:0')).toBe(10_000);
  });

  it('clamps the 16384 floor down to the model ceiling', () => {
    // The generous floor must not push nova-pro past its hard limit.
    expect(calculateMaxTokens(1, 1, 'yaml', false, 'us.amazon.nova-pro-v1:0')).toBe(10_000);
  });

  it('clamps media budgets to the model ceiling too', () => {
    expect(calculateMaxTokens(5, 1, 'yaml', true, 'us.amazon.nova-pro-v1:0')).toBe(10_000);
  });

  it('still gives Claude models the full budget', () => {
    expect(calculateMaxTokens(1, 1, 'yaml', false, 'us.anthropic.claude-opus-5')).toBe(16_384);
    expect(calculateMaxTokens(15, 10, 'json', false, 'us.anthropic.claude-opus-5')).toBe(64_000);
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
