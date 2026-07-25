import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { METHODS, METHOD_INFO, METHOD_FAMILIES, getSupportLevel } from '@idp/shared';
import { isMethodConfigured } from '../services/method-availability.js';
import { PROCESSOR_FACTORY_FOR_TEST } from '../routes/preview.js';

const SAGEMAKER = METHODS.filter((m) => m.startsWith('sagemaker-'));

/**
 * Two families were added after measuring, not after reading model cards:
 *
 *  - `video-understanding` (TwelveLabs Pegasus): verified live via InvokeModel + the
 *    `us.` inference profile on a real 9s mp4 — it returned all three ground-truth
 *    strings WITH timestamps. An earlier probe called it unavailable because it tried
 *    Converse (wrong API) and the bare model id (no on-demand throughput).
 *  - `sagemaker-ocr`: six specialist document-OCR models, benchmarked over 336 real
 *    scanned pages. They run on self-hosted GPU endpoints billed hourly even when
 *    idle, so they are opt-in and must report unavailable until configured.
 */
describe('new method families are wired end to end', () => {
  it('registers a processor for every new method', () => {
    // A method offered without a processor dies at execution with "No processor for
    // method" — the exact defect the registry-parity test exists to prevent.
    for (const method of ['twelvelabs-pegasus', ...SAGEMAKER]) {
      expect(PROCESSOR_FACTORY_FOR_TEST[method as never], `${method} has no processor`).toBeTruthy();
    }
  });

  it('gives every family a colour and label in the UI', () => {
    // Record<MethodFamily, …> makes this a compile error, but assert it too: a family
    // added to the catalog without UI entries renders as a blank chip.
    const colors = readFrontend('src/theme/family-colors.ts');
    for (const family of METHOD_FAMILIES) {
      expect(colors, `${family} missing from FAMILY_COLORS/FAMILY_LABELS`).toContain(family);
    }
  });

  it('prices Pegasus on output tokens, not per page', () => {
    // Catalog: output $0.0075/1K = $7.50/1M, no input charge and no per-page fee.
    const info = METHOD_INFO['twelvelabs-pegasus'];
    expect(info.tokenPricing.outputPer1MTokens).toBe(7.5);
    expect(info.tokenPricing.inputPer1MTokens).toBe(0);
    expect(info.estimatedCostPerPage).toBeGreaterThan(0);
  });

  it('prices specialist OCR by GPU hours, not tokens', () => {
    /*
     * These have NO token pricing — cost is instance-hours ÷ throughput. The measured
     * ml.g6e.2xlarge figure is $0.0085/image ($2.24/hr / ~263 img/hr). Reporting them
     * as free because there are no tokens would make them look strictly better than
     * every Bedrock method.
     */
    for (const method of SAGEMAKER) {
      const info = METHOD_INFO[method];
      expect(info.tokenPricing.inputPer1MTokens, method).toBe(0);
      expect(info.tokenPricing.outputPer1MTokens, method).toBe(0);
      expect(info.estimatedCostPerPage, `${method} must not be priced at zero`).toBeGreaterThan(0);
    }
  });

  it('reports specialist OCR unavailable until an endpoint is configured', () => {
    // The honest default: visible in the catalog with its benchmark numbers, but not
    // offered as runnable. Same contract as bda-custom.
    for (const method of SAGEMAKER) {
      const availability = isMethodConfigured(method);
      if (process.env[endpointEnvFor(method)]) continue; // configured in this env
      expect(availability.available, method).toBe(false);
      expect(availability.reason, method).toBe('sagemaker-endpoint-not-configured');
      // The detail must say WHY it is opt-in, since cost is the reason.
      expect(availability.detail, method).toMatch(/hourly|opt-in/i);
    }
  });

  it('rates OCR models only for what OCR actually produces', () => {
    /*
     * They return text regions with layout labels and boxes. They do NOT do semantic
     * field extraction or summarisation — claiming otherwise is the "rated the service,
     * not the adapter" defect that the matrix audit found ten times.
     */
    const method = 'sagemaker-infinity-parser2';
    expect(getSupportLevel(method, 'text_extraction')).toBe('excellent');
    expect(getSupportLevel(method, 'layout_analysis')).toBe('excellent');
    expect(getSupportLevel(method, 'bounding_box')).toBe('excellent');
    // Not rated: these need an LLM stage, exactly like Textract+LLM.
    for (const cap of ['kv_extraction', 'document_summarization', 'pii_detection'] as const) {
      const level = getSupportLevel(method, cap);
      expect(level ?? 'none', `${cap} must not be claimed by a raw OCR model`).toBe('none');
    }
  });

  it('rates Pegasus for video only', () => {
    expect(getSupportLevel('twelvelabs-pegasus', 'video_summarization')).toBe('excellent');
    // It cannot read a document at all — the catalog lists inputs as TEXT + VIDEO.
    for (const cap of ['table_extraction', 'kv_extraction'] as const) {
      expect(getSupportLevel('twelvelabs-pegasus', cap) ?? 'none', cap).toBe('none');
    }
  });
});

function endpointEnvFor(method: string): string {
  const suffix = method.replace('sagemaker-', '').replace(/-ocr$/, '').replace(/-/g, '');
  const map: Record<string, string> = {
    infinityparser2: 'SAGEMAKER_OCR_INFINITY',
    baidu: 'SAGEMAKER_OCR_BAIDU',
    surya: 'SAGEMAKER_OCR_SURYA',
    chandra: 'SAGEMAKER_OCR_CHANDRA',
    dots: 'SAGEMAKER_OCR_DOTS',
    qwen3vl: 'SAGEMAKER_OCR_QWEN3VL',
  };
  return map[suffix] ?? 'SAGEMAKER_OCR_UNKNOWN';
}

function readFrontend(rel: string): string {
  return readFileSync(join(import.meta.dirname, '..', '..', '..', 'frontend', rel), 'utf-8');
}
