/**
 * Live-AWS integration test for GuardrailsAdapter.
 *
 * Skips automatically when BEDROCK_GUARDRAIL_ID is not set.
 * When set, makes REAL ApplyGuardrail calls against the configured guardrail.
 *
 * IMPORTANT: These tests cost real money (fractions of a cent per call).
 */
import { describe, it, expect } from 'vitest';
import { GuardrailsAdapter } from '../adapters/guardrails-adapter.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';

const liveGuardrail = process.env.BEDROCK_GUARDRAIL_ID;
const describeLive = liveGuardrail ? describe : describe.skip;

function mkInput(overrides: Partial<AdapterInput> = {}): AdapterInput {
  return {
    documentBuffer: Buffer.alloc(0),
    s3Uri: 'local://none',
    fileName: 'upstream.txt',
    capabilities: ['pii_detection', 'pii_redaction'],
    pageCount: 1,
    ...overrides,
  };
}

describeLive('GuardrailsAdapter (live AWS)', () => {
  it('skips Textract when precomputedText is supplied and redacts PII from the text directly', async () => {
    const upstreamText =
      'Hi, this is John Smith. My email is john.smith@example.com and my phone is (555) 123-4567.';
    const adapter = new GuardrailsAdapter('bedrock-guardrails');
    const out = await adapter.run(null, mkInput({ precomputedText: upstreamText }));

    expect(out.results.pii_detection).toBeDefined();
    expect(out.results.pii_redaction).toBeDefined();

    const detected = out.results.pii_detection?.data as Array<{ type: string; value: string }>;
    expect(Array.isArray(detected)).toBe(true);
    expect(detected.length).toBeGreaterThan(0);

    const redacted = out.results.pii_redaction?.data as string;
    expect(typeof redacted).toBe('string');
    expect(redacted).not.toContain('john.smith@example.com');
    expect(redacted).not.toContain('(555) 123-4567');
    // Guardrails returns either local `[REDACTED:<type>]` markers (for BLOCK
    // actions) or Bedrock's native `{TYPE}` markers (for ANONYMIZE actions).
    expect(redacted).toMatch(/\[REDACTED:|\{(NAME|EMAIL|PHONE|SSN|ADDRESS)\}/);
  });

  it('returns zero hits on PII-free text with non-zero confidence', async () => {
    const upstreamText = 'The weather is nice today. This document contains no personal information.';
    const adapter = new GuardrailsAdapter('bedrock-guardrails');
    const out = await adapter.run(null, mkInput({ precomputedText: upstreamText }));

    const detected = out.results.pii_detection?.data as Array<unknown>;
    expect(detected).toEqual([]);
    // "true negative" confidence per adapter rules.
    expect(out.results.pii_detection?.confidence).toBeGreaterThan(0);
    expect(out.results.pii_detection?.confidence).toBeLessThanOrEqual(0.95);
  });

  it('handles >25KB text by chunking and aggregating hits', async () => {
    // Build a >40KB body that contains a detectable PII marker near the start
    // and near the end, so both chunks must be scanned.
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(800);
    const upstreamText =
      `Contact: jane.doe@example.com\n\n${filler}\n\nAlt contact: bob@example.com`;
    expect(new TextEncoder().encode(upstreamText).length).toBeGreaterThan(25 * 1024);

    const adapter = new GuardrailsAdapter('bedrock-guardrails');
    const out = await adapter.run(null, mkInput({ precomputedText: upstreamText }));

    const redacted = out.results.pii_redaction?.data as string;
    expect(redacted).not.toContain('jane.doe@example.com');
    expect(redacted).not.toContain('bob@example.com');

    const raw = JSON.parse(out.rawOutput ?? '{}') as { chunks?: number };
    expect(raw.chunks).toBeGreaterThan(1);
  });

  it('unsupported capabilities return confidence-0 placeholders', async () => {
    const adapter = new GuardrailsAdapter('bedrock-guardrails');
    const out = await adapter.run(null, mkInput({
      precomputedText: 'Alice lives at 123 Main St.',
      capabilities: ['table_extraction', 'pii_redaction'],
    }));

    expect(out.results.table_extraction?.confidence).toBe(0);
    expect(out.results.pii_redaction?.confidence).toBeGreaterThan(0);
  });
});
