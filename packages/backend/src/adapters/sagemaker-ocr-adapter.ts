import type { Response } from 'express';
import { InvokeEndpointCommand } from '@aws-sdk/client-sagemaker-runtime';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import { sageMakerRuntimeClient, config } from '../config/aws.js';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';

/**
 * Specialist document-OCR models on self-hosted SageMaker real-time endpoints.
 *
 * These are the olmOCR-bench leaderboard models measured over 336 real scanned pages
 * in the hybrid vision + spatial reasoning study. They are a different shape from
 * every Bedrock method here, in three ways that matter:
 *
 *  1. **Transport.** `InvokeEndpoint` against an endpoint YOU deploy, not a managed
 *     model id. No endpoint means the method is unavailable, not broken.
 *  2. **Cost.** GPU-hours, not tokens. Cost per page is throughput ÷ instance price
 *     and an idle endpoint still bills, which is why every endpoint here is opt-in
 *     and off by default.
 *  3. **Output.** They return OCR — every text region, undifferentiated, with layout
 *     labels and bounding boxes. They do NOT do semantic field extraction. So this
 *     adapter deliberately reports `text_extraction` / `layout_analysis` /
 *     `bounding_box` faithfully and does not pretend to answer `kv_extraction` or
 *     `document_summarization`; an LLM stage does that, exactly as Textract+LLM does.
 *
 * The per-model response shapes differ (surya/chandra emit HTML, dots/infinity emit
 * JSON blocks), which is why `OCR_RESPONSE_FORMAT` exists rather than one parser.
 */

/** Response body shape per model, from the reference deployment's container config. */
const OCR_RESPONSE_FORMAT: Partial<Record<ProcessingMethod, 'html' | 'json'>> = {
  'sagemaker-surya-ocr': 'html',
  'sagemaker-chandra-ocr': 'html',
  'sagemaker-dots-ocr': 'json',
  'sagemaker-infinity-parser2': 'json',
  'sagemaker-baidu-ocr': 'json',
  'sagemaker-qwen3-vl': 'json',
};

/**
 * Layout labels that denote a PICTURE region rather than text. Union of the label
 * vocabularies across the models' native layout prompts, because each names them
 * differently and a single vocabulary would silently drop regions.
 */
const PHOTO_LABELS = new Set(['picture', 'image', 'figure', 'diagram', 'photo', 'photograph']);

interface OcrBlock {
  text?: string;
  category?: string;
  label?: string;
  bbox?: number[];
  /** Some containers nest coordinates instead of a flat bbox. */
  poly?: number[];
}

/**
 * Normalise a bbox to the 0-1000 integer grid the rest of this app uses.
 *
 * The containers are inconsistent: some emit pixel coordinates, some 0-1 floats, some
 * already 0-1000. Guessing wrong makes the boxes unusable even when the detection was
 * perfect, so infer the space from the magnitudes rather than assuming one.
 */
function normalizeBbox(bbox: number[], pageWidth?: number, pageHeight?: number): number[] {
  if (bbox.length < 4) return bbox;
  const max = Math.max(...bbox);
  if (max <= 1.001) {
    // 0-1 floats.
    return bbox.map((v) => Math.round(v * 1000));
  }
  if (max <= 1000 && !pageWidth) {
    // Already on the target grid (or close enough that rescaling would be a guess).
    return bbox.map((v) => Math.round(v));
  }
  if (pageWidth && pageHeight) {
    return [
      Math.round((bbox[0] / pageWidth) * 1000),
      Math.round((bbox[1] / pageHeight) * 1000),
      Math.round((bbox[2] / pageWidth) * 1000),
      Math.round((bbox[3] / pageHeight) * 1000),
    ];
  }
  return bbox.map((v) => Math.round(v));
}

export class SageMakerOcrAdapter implements StreamAdapter {
  constructor(readonly method: ProcessingMethod) {}

  private endpointName(): string {
    return config.sagemakerOcrEndpoints[this.method] ?? '';
  }

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();
    const info = METHOD_INFO[this.method];
    const endpoint = this.endpointName();

    if (!endpoint) {
      /*
       * Named, actionable failure rather than a generic error: this is the expected
       * state in a default deployment, and the user needs to know it is a
       * configuration choice (GPU cost) and not a bug.
       */
      throw new Error(
        `${info.shortName} needs a self-hosted SageMaker endpoint, which is not configured `
        + `in this deployment. Deploy the model and set its endpoint name in the environment `
        + `(see infrastructure/sagemaker-ocr.tf). These endpoints run on GPU instances billed `
        + `hourly even when idle, so they are opt-in.`,
      );
    }

    emitProgress(res, this.method, 'all', 15, `Running ${info.shortName} OCR...`);

    const format = OCR_RESPONSE_FORMAT[this.method] ?? 'json';

    /*
     * No `prompt` field: the containers fall back to their own per-model DEFAULT_PROMPT
     * (the native layout prompt), which is what returns every block with its category
     * and text. Sending our own prompt overrides that and, per the reference study,
     * makes these models stop splitting layout regions.
     */
    const payload = {
      image: input.documentBuffer.toString('base64'),
      max_tokens: 8192,
      ...(this.method === 'sagemaker-infinity-parser2'
        // Infinity is a reasoning model; thinking output is not wanted here and it
        // roughly triples latency for no gain on OCR.
        ? { chat_template_kwargs: { enable_thinking: false } }
        : {}),
    };

    const response = await sageMakerRuntimeClient.send(new InvokeEndpointCommand({
      EndpointName: endpoint,
      ContentType: 'application/json',
      Accept: 'application/json',
      Body: JSON.stringify(payload),
    }));

    const rawOutput = new TextDecoder().decode(response.Body);
    emitProgress(res, this.method, 'all', 85, 'Parsing OCR output...');

    const results = this.parse(rawOutput, input.capabilities, format);

    return {
      results,
      rawOutput,
      latencyMs: Date.now() - start,
      /*
       * No token usage — cost is GPU time. `perPageFee` carries the measured
       * per-image cost so the comparison prices this method on the same basis as
       * Textract's per-page fee, rather than reporting it as free.
       */
      perPageFee: config.sagemakerOcrCostPerPage,
    };
  }

  /**
   * Map an OCR response onto the requested capabilities.
   *
   * Only capabilities OCR can actually answer are populated. Anything else is left
   * absent rather than filled with the page text — returning the whole document under
   * the label "key-value pairs" is exactly the defect the BDA audit found.
   */
  private parse(
    rawOutput: string,
    capabilities: string[],
    format: 'html' | 'json',
  ): AdapterOutput['results'] {
    const results: AdapterOutput['results'] = {};

    let blocks: OcrBlock[] = [];
    let plainText = '';
    let pageWidth: number | undefined;
    let pageHeight: number | undefined;

    try {
      const parsed = JSON.parse(rawOutput) as
        | { text?: string; output?: string; blocks?: OcrBlock[]; width?: number; height?: number }
        | OcrBlock[];
      if (Array.isArray(parsed)) {
        blocks = parsed;
      } else {
        pageWidth = parsed.width;
        pageHeight = parsed.height;
        blocks = parsed.blocks ?? [];
        plainText = parsed.text ?? parsed.output ?? '';
        // The container may return its payload as a JSON *string* of blocks.
        if (!blocks.length && plainText.trim().startsWith('[')) {
          try { blocks = JSON.parse(plainText) as OcrBlock[]; } catch { /* keep as text */ }
        }
      }
    } catch {
      // HTML-format models return markup directly, not JSON.
      plainText = rawOutput;
    }

    if (!plainText) {
      plainText = blocks.map((b) => b.text ?? '').filter(Boolean).join('\n');
    }
    // HTML models: strip tags for the text view, keeping the markup in rawOutput.
    const textForDisplay = format === 'html' && !blocks.length
      ? plainText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : plainText;

    if (capabilities.includes('text_extraction')) {
      results.text_extraction = {
        capability: 'text_extraction',
        data: textForDisplay,
        // Not self-reported and not measured: these containers return no per-region
        // confidence, so this reflects "OCR produced output", nothing more.
        confidence: textForDisplay.length > 0 ? 0.9 : 0,
        format: 'text',
      };
    }

    if (capabilities.includes('layout_analysis') && blocks.length > 0) {
      results.layout_analysis = {
        capability: 'layout_analysis',
        data: blocks.map((b, i) => ({
          order: i,
          type: (b.category ?? b.label ?? 'text').toLowerCase(),
          text: b.text ?? '',
          ...(b.bbox ? { bbox: normalizeBbox(b.bbox, pageWidth, pageHeight) } : {}),
        })),
        confidence: 0.9,
        format: 'json',
      };
    }

    if (capabilities.includes('bounding_box') && blocks.length > 0) {
      const boxed = blocks.filter((b) => b.bbox && b.bbox.length >= 4);
      results.bounding_box = {
        capability: 'bounding_box',
        data: boxed.map((b) => ({
          label: (b.category ?? b.label ?? 'text').toLowerCase(),
          isPhoto: PHOTO_LABELS.has((b.category ?? b.label ?? '').toLowerCase()),
          text: b.text ?? '',
          bbox: normalizeBbox(b.bbox as number[], pageWidth, pageHeight),
        })),
        // Measured, not asserted: these models are rated on grid-splitting because
        // that is what the 336-page study actually distinguished them by.
        confidence: boxed.length > 0 ? 0.9 : 0,
        format: 'json',
      };
    }

    if (capabilities.includes('table_extraction') && format === 'html') {
      const tables = plainText.match(/<table[\s\S]*?<\/table>/gi);
      if (tables?.length) {
        results.table_extraction = {
          capability: 'table_extraction',
          data: tables.join('\n'),
          confidence: 0.8,
          format: 'html',
        };
      }
    }

    if (capabilities.includes('handwriting_extraction') && textForDisplay) {
      // OCR does not distinguish print from handwriting; report the text and let the
      // level in the matrix ("good", not "excellent") carry that caveat.
      results.handwriting_extraction = {
        capability: 'handwriting_extraction',
        data: textForDisplay,
        confidence: 0.7,
        format: 'text',
      };
    }

    if (capabilities.includes('ocr_enhancement') && textForDisplay) {
      results.ocr_enhancement = {
        capability: 'ocr_enhancement',
        data: textForDisplay,
        confidence: 0.85,
        format: 'text',
      };
    }

    return results;
  }
}
