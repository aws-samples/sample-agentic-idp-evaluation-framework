import { describe, it, expect } from 'vitest';
import {
  isModelBackedCapability,
  filterModelBackedCapabilities,
  getUnavailableReason,
  CAPABILITY_INFO,
} from '@idp/shared';
import { buildSystemPrompt, CAPABILITY_GUIDANCE } from '../adapters/extraction-shared.js';
import { applyOutputCap } from '../services/token-budget.js';

/**
 * pdf_conversion and format_standardization declare no method support because
 * they are pipeline preprocessing, not model tasks. They were still being
 * auto-selected and injected into every LLM prompt, where they fell through to
 * the generic "Extract <name> data." instruction and asked models for output
 * that cannot exist.
 */
describe('preprocessing capabilities are not model tasks', () => {
  // ocr_enhancement joined this set once its support matrix was corrected: it
  // claimed textract-llm "limited" for deskew/denoise/contrast/binarization, none
  // of which exists anywhere in the codebase (grep finds no implementation).
  const PREPROCESSING = ['pdf_conversion', 'format_standardization'] as const;

  /*
   * ocr_enhancement LEFT this set when the specialist OCR family was added.
   *
   * It was unroutable because nothing here implemented deskew/denoise/binarization —
   * true while every method was a Bedrock model. The self-hosted OCR models (Surya,
   * Chandra, dots, Infinity, Baidu, Qwen3-VL) genuinely do produce a cleaned,
   * layout-aware reading of a scanned page, which is what this capability asks for.
   * It is now routable when an endpoint is configured, and reports
   * `sagemaker-endpoint-not-configured` otherwise — a deployment gap, not an
   * impossibility, so it must NOT carry an unavailable-reason entry.
   */

  /*
   * Capabilities no method here can perform. NOT all of these are preprocessing:
   * `barcode_qr` is a real IDP requirement that needs a deterministic decoder.
   * Measured against live Bedrock with a known QR payload — Opus 5 returned an
   * empty string, Sonnet 5 and Nova 2 Lite both answered CANNOT_DECODE — so the
   * previous `limited` rating across 17 methods claimed an ability that does not
   * exist. Decoding is exact error-correcting math, not perception.
   */
  const UNROUTABLE = [
    ...PREPROCESSING,
    'barcode_qr',
    // No adapter surfaces an image asset: BDA is never asked for figure crops and
    // there is no parse case, so this used to answer with the page's markdown text
    // labelled "extracted images".
    'image_separation',
    // Not an embedding invocation at all — KB ingestion is StartIngestionJob on the
    // bedrock-agent control plane, and @aws-sdk/client-bedrock-agent is not even a
    // dependency. The `embeddings: excellent` rating made it pass the routable
    // filter that routes/pipeline.ts already documents it as failing.
    'knowledge_base_ingestion',
  ] as const;

  it('identifies preprocessing capabilities as not model-backed', () => {
    for (const cap of PREPROCESSING) {
      expect(isModelBackedCapability(cap)).toBe(false);
    }
  });

  it('pins the exact set, so a capability cannot silently become unroutable', () => {
    // A capability whose support matrix is emptied stops appearing in every
    // pipeline with no error. Listing the intended set makes that a test failure.
    const unroutable = Object.keys(CAPABILITY_INFO)
      .filter((id) => !isModelBackedCapability(id as never))
      .sort();
    expect(unroutable).toEqual([...UNROUTABLE].sort());
  });

  it('every unroutable capability states WHY, and what would fix it', () => {
    /*
     * The point of the reason table: an empty support row is indistinguishable
     * from a capability the catalog forgot to rate. Anything a user can select but
     * nothing can run must explain itself in the UI, so a new unroutable
     * capability without a reason is a test failure rather than a silent grey row.
     */
    for (const cap of UNROUTABLE) {
      const reason = getUnavailableReason(cap as never);
      expect(reason, `${cap} has no CAPABILITY_UNAVAILABLE_REASON entry`).toBeTruthy();
      expect(reason!.summary.length, `${cap} summary too short`).toBeGreaterThan(20);
      expect(reason!.needs.length, `${cap} needs too short`).toBeGreaterThan(10);
    }
  });

  it('separates "no model can do it" from "blocked by this deployment"', () => {
    /*
     * Two genuinely different kinds of unavailable, which this test exists to keep
     * distinct:
     *
     *  - no model backing at all (`isModelBackedCapability` false) — preprocessing
     *    steps, and barcode_qr where every model demonstrably cannot decode.
     *  - model backing EXISTS but this deployment cannot reach it — embeddings map
     *    to a real Nova model that is only offered in us-east-1 while this app runs
     *    in us-west-2, and knowledge_base_ingestion additionally needs a vector
     *    store. Those rate a family in the matrix and are filtered at routing time
     *    by `isMethodConfigured`, not by the support matrix.
     *
     * Collapsing them would either mislabel a region problem as "impossible" or
     * imply barcode decoding is one deploy away from working.
     */
    // knowledge_base_ingestion is NOT here: it declares no model support at all now,
    // because no model is the missing piece — the control-plane API is.
    const DEPLOYMENT_BLOCKED = ['embedding_generation'];

    for (const id of Object.keys(CAPABILITY_INFO)) {
      if (!getUnavailableReason(id as never)) continue;
      const modelBacked = isModelBackedCapability(id as never);
      if (DEPLOYMENT_BLOCKED.includes(id)) {
        expect(modelBacked, `${id} should still declare model support`).toBe(true);
        expect(getUnavailableReason(id as never)!.kind).toMatch(/needs-region|needs-infrastructure/);
      } else {
        expect(
          modelBacked,
          `${id} has an unavailable-reason but IS routable — remove the entry`,
        ).toBe(false);
      }
    }
  });

  it('identifies real extraction capabilities as model-backed', () => {
    for (const cap of ['text_extraction', 'table_extraction', 'kv_extraction', 'pii_detection'] as const) {
      expect(isModelBackedCapability(cap)).toBe(true);
    }
  });

  it('filters preprocessing out of a capability list, preserving order', () => {
    const filtered = filterModelBackedCapabilities([
      'table_extraction',
      'pdf_conversion',
      'kv_extraction',
    ] as const);
    expect(filtered).toEqual(['table_extraction', 'kv_extraction']);
  });

  it('keeps preprocessing capabilities out of the model prompt', () => {
    const prompt = buildSystemPrompt(['table_extraction', 'pdf_conversion', 'kv_extraction']);
    expect(prompt).toContain('table_extraction');
    expect(prompt).toContain('kv_extraction');
    expect(prompt).not.toContain('pdf_conversion');
    // The meaningless fallback instruction must not appear either.
    expect(prompt).not.toContain('Extract pdf conversion data');
  });

  it('does not produce an empty capability list if ONLY preprocessing was asked for', () => {
    // Degenerate input should still yield a usable prompt rather than one with
    // no capabilities at all.
    const prompt = buildSystemPrompt(['pdf_conversion']);
    expect(prompt).toContain('pdf_conversion');
  });

  it('every model-backed capability has explicit guidance or a real support matrix', () => {
    // Guards against a new capability silently relying on the generic fallback.
    for (const [id, info] of Object.entries(CAPABILITY_INFO)) {
      if (!isModelBackedCapability(id as never)) continue;
      const hasGuidance = !!CAPABILITY_GUIDANCE[id];
      const hasSupport = Object.values(info.support ?? {}).some((l) => l && l !== 'none');
      expect(hasGuidance || hasSupport).toBe(true);
    }
  });
});

/**
 * Preview runs every method in parallel and the user waits on the slowest one.
 * A real document once drove Nova 2 Lite to the 16384-token output ceiling and
 * a 161s response, versus ~5s normally.
 */
describe('applyOutputCap', () => {
  it('caps a generous budget down for interactive preview', () => {
    expect(applyOutputCap(16384, 4096)).toBe(4096);
  });

  it('leaves the budget untouched when no cap is given', () => {
    expect(applyOutputCap(16384, undefined)).toBe(16384);
    expect(applyOutputCap(16384, 0)).toBe(16384);
  });

  it('never raises a budget above what was computed', () => {
    expect(applyOutputCap(2048, 4096)).toBe(2048);
  });
});
