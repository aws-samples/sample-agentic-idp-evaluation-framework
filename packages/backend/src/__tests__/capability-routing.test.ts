import { describe, it, expect } from 'vitest';
import {
  getBestMethodsForCapability,
  METHOD_INFO,
  CAPABILITY_SUPPORT,
} from '@idp/shared';

describe('getBestMethodsForCapability — PII tie-breaker', () => {
  it('ranks bedrock-guardrails first for pii_detection when multiple methods are "excellent"', () => {
    const methods = getBestMethodsForCapability('pii_detection');
    expect(methods[0]).toBe('bedrock-guardrails');
  });

  it('ranks bedrock-guardrails first for pii_redaction when multiple methods are "excellent"', () => {
    const methods = getBestMethodsForCapability('pii_redaction');
    expect(methods[0]).toBe('bedrock-guardrails');
  });

  it('does NOT elevate guardrails for non-PII capabilities', () => {
    const methods = getBestMethodsForCapability('table_extraction');
    expect(methods[0]).not.toBe('bedrock-guardrails');
  });

  it('guardrails retains "excellent" support ordering vs others', () => {
    // Sanity check — confirm the underlying support matrix still lists both
    // claude and guardrails as "excellent" for pii_redaction. If this ever
    // flips to 'good', the tie-breaker assumption changes.
    expect(CAPABILITY_SUPPORT['guardrails']?.['pii_redaction']).toBe('excellent');
    expect(CAPABILITY_SUPPORT['claude']?.['pii_redaction']).toBe('excellent');
  });

  it('skips guardrails when capability has no support in that family', () => {
    const methods = getBestMethodsForCapability('table_extraction');
    expect(methods.every((m) => METHOD_INFO[m].family !== 'guardrails')).toBe(true);
  });

  it('returns at least one method for every PII capability', () => {
    for (const cap of ['pii_detection', 'pii_redaction'] as const) {
      const methods = getBestMethodsForCapability(cap);
      expect(methods.length).toBeGreaterThan(0);
    }
  });
});
