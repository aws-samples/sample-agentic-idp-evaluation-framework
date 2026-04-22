import { describe, it, expect } from 'vitest';
import { isMethodLanguageCompatible } from '@idp/shared';

describe('isMethodLanguageCompatible', () => {
  it('permits every method for empty language list', () => {
    const methods = [
      'claude-sonnet',
      'claude-haiku',
      'nova-lite',
      'bda-standard',
      'textract-claude-sonnet',
      'bedrock-guardrails',
    ] as const;
    for (const m of methods) {
      expect(isMethodLanguageCompatible(m, [])).toBe(true);
    }
  });

  it('permits every method when primary language is English', () => {
    const methods = [
      'claude-sonnet',
      'bda-standard',
      'textract-claude-sonnet',
      'bedrock-guardrails',
    ] as const;
    for (const m of methods) {
      expect(isMethodLanguageCompatible(m, ['en', 'ko'])).toBe(true);
      expect(isMethodLanguageCompatible(m, ['english', 'korean'])).toBe(true);
    }
  });

  it('excludes BDA / textract-llm / guardrails when primary is non-English', () => {
    expect(isMethodLanguageCompatible('bda-standard', ['ko'])).toBe(false);
    expect(isMethodLanguageCompatible('bda-claude-sonnet', ['ko'])).toBe(false);
    expect(isMethodLanguageCompatible('textract-claude-sonnet', ['ko'])).toBe(false);
    expect(isMethodLanguageCompatible('bedrock-guardrails', ['ko'])).toBe(false);
  });

  it('keeps Claude / Nova methods available for non-English docs', () => {
    expect(isMethodLanguageCompatible('claude-sonnet', ['ko'])).toBe(true);
    expect(isMethodLanguageCompatible('claude-haiku', ['ko'])).toBe(true);
    expect(isMethodLanguageCompatible('nova-lite', ['ko'])).toBe(true);
    expect(isMethodLanguageCompatible('nova-pro', ['ja'])).toBe(true);
  });

  it('treats English-only list as fully compatible', () => {
    expect(isMethodLanguageCompatible('bedrock-guardrails', ['en', 'en-US'])).toBe(true);
  });

  it('is case-insensitive on language codes', () => {
    expect(isMethodLanguageCompatible('bedrock-guardrails', ['EN'])).toBe(true);
    expect(isMethodLanguageCompatible('bedrock-guardrails', ['ENGLISH'])).toBe(true);
  });
});
