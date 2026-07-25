import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TEXTRACT_PAGE_PRICING, METHOD_INFO } from '@idp/shared';

/**
 * Textract must only ever be used for plain OCR (DetectDocumentText, $0.0015/page).
 *
 * AnalyzeDocument's analysis features cost up to 43x more per page ($0.015 TABLES,
 * $0.05 FORMS, $0.065 TABLES+FORMS) and in this app their output is discarded — the
 * LLM does the structuring, and Guardrails only needs a flat string of text. The
 * Guardrails adapter did call AnalyzeDocument with FORMS while its cost was
 * modelled at $0.0016/page, so real spend was ~33x what was reported.
 *
 * These are grep-style tests on purpose: the failure mode is someone reintroducing
 * an expensive call in any adapter, which no unit test of a single module catches.
 */
const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strip comments so documentation mentioning the API does not trip the check. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('Textract is OCR-only', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check (guards against a broken glob)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no adapter or route issues an AnalyzeDocument-family call', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      for (const api of [
        'AnalyzeDocumentCommand',
        'StartDocumentAnalysisCommand',
        'GetDocumentAnalysisCommand',
        'AnalyzeExpenseCommand',
        'AnalyzeIDCommand',
      ]) {
        if (code.includes(api)) offenders.push(`${file.replace(SRC, 'src')}: ${api}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never requests Textract FeatureTypes', () => {
    const offenders = files
      .filter((f) => stripComments(readFileSync(f, 'utf-8')).includes('FeatureTypes'))
      .map((f) => f.replace(SRC, 'src'));
    expect(offenders).toEqual([]);
  });

  it('the per-page fee charged for Textract stages is the OCR price', () => {
    expect(TEXTRACT_PAGE_PRICING.detectText).toBeCloseTo(0.0015, 6);
    // Guardrails = Textract OCR + the sensitive-information policy, so its
    // estimate must stay in the OCR range rather than the analysis range.
    const guardrails = METHOD_INFO['bedrock-guardrails'].estimatedCostPerPage;
    expect(guardrails).toBeLessThan(TEXTRACT_PAGE_PRICING.analyzeDocument.LAYOUT);
    expect(guardrails).toBeGreaterThanOrEqual(TEXTRACT_PAGE_PRICING.detectText);
  });

  it('every textract-llm method is priced above bare OCR but far below FORMS', () => {
    for (const [id, info] of Object.entries(METHOD_INFO)) {
      if (info.family !== 'textract-llm') continue;
      expect(info.estimatedCostPerPage, id).toBeGreaterThan(TEXTRACT_PAGE_PRICING.detectText);
      expect(info.estimatedCostPerPage, id).toBeLessThan(TEXTRACT_PAGE_PRICING.analyzeDocument.FORMS);
    }
  });
});
