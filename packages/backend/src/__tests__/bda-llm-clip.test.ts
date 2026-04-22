import { describe, it, expect } from 'vitest';
import { clipBdaOutputForLlm } from '../adapters/bda-llm-adapter.js';

const HAIKU = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET = 'us.anthropic.claude-sonnet-4-6';
const NOVA_LITE = 'us.amazon.nova-2-lite-v1:0';

describe('clipBdaOutputForLlm', () => {
  it('passes small outputs through untouched', () => {
    const raw = 'hello world';
    const { text, clipped, originalChars } = clipBdaOutputForLlm(raw, HAIKU);
    expect(text).toBe(raw);
    expect(clipped).toBe(false);
    expect(originalChars).toBe(raw.length);
  });

  it('clips outputs that exceed Haiku budget', () => {
    const raw = 'x'.repeat(2_000_000);
    const { text, clipped, originalChars } = clipBdaOutputForLlm(raw, HAIKU);
    expect(clipped).toBe(true);
    expect(originalChars).toBe(raw.length);
    // Haiku budget 180k tokens * 3.5 chars/tok = ~630k chars.
    expect(text.length).toBeLessThan(650_000);
    expect(text).toContain('[... BDA output truncated');
  });

  it('preserves document head and tail', () => {
    const head = 'HEAD_MARKER_UNIQUE';
    const tail = 'TAIL_MARKER_UNIQUE';
    const raw = head + 'x'.repeat(2_000_000) + tail;
    const { text } = clipBdaOutputForLlm(raw, HAIKU);
    expect(text.startsWith(head)).toBe(true);
    expect(text.endsWith(tail)).toBe(true);
  });

  it('Sonnet allows larger payloads through without clipping', () => {
    const raw = 'y'.repeat(1_500_000);
    // Sonnet budget 700k tokens → 2.45M chars, so 1.5M passes through.
    const { clipped } = clipBdaOutputForLlm(raw, SONNET);
    expect(clipped).toBe(false);
  });

  it('unknown model IDs fall back to the Haiku-class budget', () => {
    const raw = 'z'.repeat(2_000_000);
    const { clipped, text } = clipBdaOutputForLlm(raw, 'us.unknown.model-vX');
    expect(clipped).toBe(true);
    expect(text.length).toBeLessThan(650_000);
  });

  it('Nova Lite budget is larger than Haiku but smaller than Sonnet', () => {
    // Pick a size that Haiku clips (>630k chars) but Nova Lite passes (<875k).
    const raw = 'w'.repeat(700_000);
    const haiku = clipBdaOutputForLlm(raw, HAIKU);
    const nova = clipBdaOutputForLlm(raw, NOVA_LITE);
    expect(haiku.clipped).toBe(true);
    expect(nova.clipped).toBe(false);
  });
});
