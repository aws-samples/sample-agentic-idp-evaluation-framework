import { describe, it, expect } from 'vitest';
import type { PipelineGenerateRequest, ProcessingMethod } from '@idp/shared';
import { detectScripts, getMethodFamily, isMethodLanguageCompatible } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';

const KOREAN = '견적서 QT-2026-0417 대한정밀기계 주식회사 수신 서울전자 구매팀 정밀 베어링 오일 시일';
const ENGLISH = 'INVOICE INV-88421 Northwind Supplies Ltd Bill To Contoso Manufacturing PO-55190';

function methodsFor(languages: string[], optimizeFor: 'balanced' | 'accuracy' | 'cost' | 'speed') {
  const request = {
    documentType: 'pdf',
    capabilities: ['text_extraction', 'table_extraction'],
    optimizeFor,
    enableHybridRouting: false,
    documentLanguages: languages,
  } as unknown as PipelineGenerateRequest;
  const { pipeline } = generatePipeline(request);
  return pipeline.nodes
    .filter((n) => n.type === 'method')
    .map((n) => (n.config as { method: ProcessingMethod }).method);
}

/**
 * Non-English routing was silently conditional on the advisor interview.
 *
 * `isMethodLanguageCompatible` has always excluded BDA and Textract+LLM for
 * non-Latin documents, and that rule is right — measured against a Korean quotation
 * with known ground truth, recall of content verifiably present on the page was 32%
 * for every BDA method and 37-42% for every Textract hybrid, versus 100% for the
 * Claude and GPT tiers. Worse, `textract-nova-lite` reported 87% self-confidence
 * and `bda-nova-lite` 93% while recovering a third of the document, so the app's own
 * ranking (which sorts on self-reported confidence) actively preferred them.
 *
 * But the rule only fires when `documentLanguages` is populated, and the ONLY thing
 * that populated it was the Socratic interview — so every user who clicked "Skip
 * questions, use defaults" got the bad routing with no warning. Script detection
 * from the extracted text closes that hole.
 */
describe('script detection', () => {
  it('identifies Korean and keeps it ahead of English', () => {
    const d = detectScripts(KOREAN);
    // Primary first: isMethodLanguageCompatible reads languages[0].
    expect(d.languages[0]).toBe('ko');
    expect(d.scripts).toContain('Korean');
  });

  it('identifies plain English as Latin only', () => {
    const d = detectScripts(ENGLISH);
    expect(d.languages).toEqual(['en']);
    expect(d.nonLatinRatio).toBe(0);
  });

  it('reroutes a mostly-English document that contains real Korean content', () => {
    // A Korean address block on an English invoice is still content BDA mangles.
    const d = detectScripts(`${ENGLISH} 총액 오백원 대한정밀기계 서울전자 구매팀 베어링`);
    expect(d.languages[0]).toBe('ko');
  });

  it('does NOT reroute on a single stray CJK glyph', () => {
    // A font name or copyright mark must not change routing for an English doc.
    const d = detectScripts(`${ENGLISH} Copyright 2026 Acme 株 all rights reserved`);
    expect(d.languages).toEqual(['en']);
  });

  it('returns no language rather than guessing English on text with no letters', () => {
    // Guessing "en" here would silently re-enable the excluded methods.
    expect(detectScripts('12345 678.90 2026-01-01').languages).toEqual([]);
    expect(detectScripts('').languages).toEqual([]);
  });

  it('distinguishes Japanese from Chinese by kana', () => {
    expect(detectScripts('請求書 ご請求金額 カタカナ').languages[0]).toBe('ja');
  });
});

describe('detected script drives pipeline routing', () => {
  const STRATEGIES = ['balanced', 'accuracy', 'cost', 'speed'] as const;

  it('excludes BDA and Textract for a Korean document, under every strategy', () => {
    const languages = detectScripts(KOREAN).languages;
    for (const optimizeFor of STRATEGIES) {
      const methods = methodsFor(languages, optimizeFor);
      expect(methods.length, optimizeFor).toBeGreaterThan(0);
      for (const m of methods) {
        const family = getMethodFamily(m);
        expect(
          family === 'bda' || family === 'bda-llm' || family === 'textract-llm',
          `${optimizeFor} picked ${m} (${family}); measured 32-42% recall on Korean`,
        ).toBe(false);
      }
    }
  });

  it('still allows BDA and Textract for an English document', () => {
    // The exclusion must be scoped to non-Latin scripts, not applied globally —
    // Textract+LLM is the cheapest accurate path on English.
    const languages = detectScripts(ENGLISH).languages;
    const allowed = new Set<ProcessingMethod>();
    for (const optimizeFor of STRATEGIES) {
      for (const m of methodsFor(languages, optimizeFor)) allowed.add(m);
    }
    for (const m of allowed) {
      expect(isMethodLanguageCompatible(m, languages), m).toBe(true);
    }
  });

  it('explains the exclusion with the measured numbers, not a vague caveat', () => {
    const { rationale } = generatePipeline({
      documentType: 'pdf',
      capabilities: ['text_extraction'],
      optimizeFor: 'balanced',
      enableHybridRouting: false,
      documentLanguages: ['ko', 'en'],
    } as unknown as PipelineGenerateRequest);
    // "do not reliably support" reads as a minor quality note; 32% is not minor.
    expect(rationale).toMatch(/32%/);
    expect(rationale).toMatch(/Language Constraint/);
  });

  it('does not add a language constraint for an English document', () => {
    const { rationale } = generatePipeline({
      documentType: 'pdf',
      capabilities: ['text_extraction'],
      optimizeFor: 'balanced',
      enableHybridRouting: false,
      documentLanguages: ['en'],
    } as unknown as PipelineGenerateRequest);
    expect(rationale).not.toMatch(/Language Constraint/);
  });
});
