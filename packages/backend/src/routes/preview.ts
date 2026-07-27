import { Router } from 'express';
import type { Capability, ProcessingMethod, ProcessorResult } from '@idp/shared';
import { getBestMethodsForCapability, METHOD_INFO, detectScripts } from '@idp/shared';
import { getDocumentBuffer } from '../services/s3.js';
import { convertOfficeDocument, isOfficeFormat } from '../services/file-converter.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';
import { ProcessorBase } from '../processors/processor-base.js';
import { BdaStandardProcessor, BdaCustomProcessor } from '../processors/bda-processor.js';
import { BdaClaudeSonnetProcessor, BdaClaudeHaikuProcessor, BdaNovaLiteProcessor } from '../processors/bda-llm.js';
import { ClaudeSonnetProcessor, ClaudeHaikuProcessor, ClaudeOpusProcessor, ClaudeOpus5Processor, ClaudeOpus48Processor, ClaudeOpus47Processor, ClaudeSonnet5Processor } from '../processors/claude-direct.js';
import { NovaLiteProcessor } from '../processors/nova-direct.js';
import { Gpt56SolProcessor, Gpt56TerraProcessor, Gpt56LunaProcessor, Gpt55Processor } from '../processors/gpt-direct.js';
import { TextractClaudeSonnetProcessor, TextractClaudeHaikuProcessor, TextractNovaLiteProcessor } from '../processors/textract-llm.js';
import { BedrockGuardrailsProcessor } from '../processors/guardrails.js';
import { TwelveLabsPegasusProcessor } from '../processors/pegasus.js';
import {
  SageMakerInfinityParser2Processor,
  SageMakerBaiduOcrProcessor,
  SageMakerSuryaOcrProcessor,
  SageMakerChandraOcrProcessor,
  SageMakerDotsOcrProcessor,
  SageMakerQwen3VlProcessor,
} from '../processors/sagemaker-ocr.js';
import { getMethodAvailability } from '../services/method-availability.js';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { trackActivity, trackRunResults } from '../services/activity-tracker.js';
import { extractUpstreamText } from '../services/pipeline-text-extractor.js';
import { randomUUID } from 'crypto';
import { validateBody } from '../middleware/validate-body.js';

interface PreviewRequest {
  documentId: string;
  s3Uri: string;
  capabilities: Capability[];
  methods?: ProcessingMethod[];
  userInstruction?: string;
  documentLanguages?: string[];
}

// Return all available methods (filtered by config). Let the LLM/agent decide which to use.
function getAvailableMethods(requestedMethods?: ProcessingMethod[]): ProcessingMethod[] {
  if (requestedMethods?.length) return requestedMethods;

  // All methods that have processors registered
  return (Object.keys(PROCESSOR_FACTORY) as ProcessingMethod[]);
}

const PROCESSOR_FACTORY: Partial<Record<ProcessingMethod, () => ProcessorBase>> = {
  'bda-standard': () => new BdaStandardProcessor(),
  // preview already filters bda-custom on BDA_PROJECT_ARN, but the processor
  // was never registered, so the method could never be offered at all.
  'bda-custom': () => new BdaCustomProcessor(),
  'bda-claude-sonnet': () => new BdaClaudeSonnetProcessor(),
  'bda-claude-haiku': () => new BdaClaudeHaikuProcessor(),
  'bda-nova-lite': () => new BdaNovaLiteProcessor(),
  'claude-sonnet': () => new ClaudeSonnetProcessor(),
  'claude-haiku': () => new ClaudeHaikuProcessor(),
  'claude-opus': () => new ClaudeOpusProcessor(),
  'claude-opus-5': () => new ClaudeOpus5Processor(),
  'claude-opus-4-8': () => new ClaudeOpus48Processor(),
  'claude-opus-4-7': () => new ClaudeOpus47Processor(),
  'claude-sonnet-5': () => new ClaudeSonnet5Processor(),
  'nova-lite': () => new NovaLiteProcessor(),
  'gpt-5-6-sol': () => new Gpt56SolProcessor(),
  'gpt-5-6-terra': () => new Gpt56TerraProcessor(),
  'gpt-5-6-luna': () => new Gpt56LunaProcessor(),
  'gpt-5-5': () => new Gpt55Processor(),
  'textract-claude-sonnet': () => new TextractClaudeSonnetProcessor(),
  'textract-claude-haiku': () => new TextractClaudeHaikuProcessor(),
  'textract-nova-lite': () => new TextractNovaLiteProcessor(),
  'bedrock-guardrails': () => new BedrockGuardrailsProcessor(),
  // Purpose-built video understanding (InvokeModel + inference profile).
  'twelvelabs-pegasus': () => new TwelveLabsPegasusProcessor(),
  // Specialist OCR on self-hosted SageMaker endpoints. Registered so they can run
  // when configured; availability gating reports them unavailable until then.
  'sagemaker-infinity-parser2': () => new SageMakerInfinityParser2Processor(),
  'sagemaker-baidu-ocr': () => new SageMakerBaiduOcrProcessor(),
  'sagemaker-surya-ocr': () => new SageMakerSuryaOcrProcessor(),
  'sagemaker-chandra-ocr': () => new SageMakerChandraOcrProcessor(),
  'sagemaker-dots-ocr': () => new SageMakerDotsOcrProcessor(),
  'sagemaker-qwen3-vl': () => new SageMakerQwen3VlProcessor(),
};

function estimatePageCount(buffer: Buffer): number {
  const content = buffer.toString('binary');
  const matches = content.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 1;
}

/**
 * Per-method ceiling for the preview step.
 *
 * This exists only to stop a genuinely stuck method from holding the SSE stream
 * open forever — NOT to enforce a latency budget. It was 60s, chosen from
 * single-page test documents, and that turned out to be far too aggressive on
 * real work: a 6-page Korean quotation with dense tables took Nova 2 Lite 41.8s
 * and Haiku 45.6s, and cancelled 9 of 12 methods — every Opus and Sonnet tier and
 * three GPT tiers — so the comparison showed 3 results and 9 identical
 * "exceeded the 60s preview limit" errors. A cancelled method is worse than a
 * slow one: the user still waits, still pays for the tokens already generated,
 * and learns nothing about the model.
 *
 * 5 minutes is above any plausible healthy run (the slowest observed real method
 * is ~46s) while still bounding a hang. Results stream in as each method
 * finishes, so a slow method no longer blocks seeing the fast ones.
 */
const PREVIEW_METHOD_TIMEOUT_MS = 300_000;

/**
 * Output-token cap for preview runs, scaled by document size.
 *
 * A flat cap is wrong in both directions: a single-page invoice needs only a few
 * hundred output tokens, while a 30-page report legitimately produces many
 * thousands and would be truncated mid-table. So the cap tracks page count and
 * capability count, and only exists to stop a runaway — a model generating all
 * the way to the model ceiling (16k+) while the user waits on the slowest method
 * in a parallel comparison.
 *
 * Truncated preview output is still useful (it is a sample, and the Pipeline step
 * runs untruncated), but it should not be the common case for a real document.
 */
/*
 * These were 1,200/page + 1,500/capability, which put a 1-page, 2-capability request
 * at 4,200 output tokens — and that is simply not enough for real output. Measured on
 * a single dense page: table_extraction alone emitted ~3,900 tokens of HTML (six
 * tables), and bounding_box on the same page emitted ~2,600 tokens of per-cell boxes.
 * Together they need roughly 6,500, so the response was cut off mid-value and the
 * fragment was reported as a success.
 *
 * The per-capability term matters far more than the per-page term here, because the
 * expensive capabilities are the structured ones (tables, boxes, layout) whose output
 * scales with density rather than page count. Raised so a realistic single-page
 * request fits, with the 32k ceiling still bounding a runaway.
 *
 * maxTokens is an upper BOUND, not an allocation — you are billed for tokens actually
 * generated — so a larger cap costs nothing on short answers and only prevents
 * truncation on long ones.
 */
const PREVIEW_TOKENS_PER_PAGE = 2_000;
const PREVIEW_TOKENS_PER_CAPABILITY = 4_000;
/** Ceiling for preview specifically; full runs may go to the model maximum. */
const PREVIEW_MAX_OUTPUT_TOKENS = 32_000;

function previewOutputCap(capabilityCount: number, pageCount: number): number {
  // No floor: the per-capability and per-page terms already cover the smallest
  // real request, and a floor cannot prevent truncation the formula would not
  // have caused anyway — a model that needs fewer tokens simply emits fewer.
  const scaled =
    capabilityCount * PREVIEW_TOKENS_PER_CAPABILITY + pageCount * PREVIEW_TOKENS_PER_PAGE;
  return Math.min(scaled, PREVIEW_MAX_OUTPUT_TOKENS);
}

class MethodTimeoutError extends Error {
  constructor(method: string, ms: number) {
    super(`Stopped waiting after ${Math.round(ms / 60_000)} minutes. Run this method from the Pipeline step for a full, untimed execution.`);
    this.name = 'MethodTimeoutError';
  }
}

/**
 * Reject after `ms` if `promise` has not settled.
 *
 * Note this bounds how long preview WAITS, not the upstream Bedrock call
 * itself — the underlying request keeps running until the SDK gives up. That is
 * an acceptable trade for preview, where the goal is to stop one slow method
 * from blocking the user's view of the other twenty.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, method: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MethodTimeoutError(method, ms)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

const router = Router();

router.post('/', validateBody({ documentId: 'string', s3Uri: 'string', capabilities: 'array' }), async (req, res) => {
  const body = req.body as PreviewRequest;

  if (!body.documentId || !body.capabilities?.length) {
    res.status(400).json({ error: 'documentId and capabilities are required' });
    return;
  }

  try {
    const s3Uri = body.s3Uri;
    const fileName = s3Uri.split('/').pop() ?? '';
    let docBuffer = await getDocumentBuffer(s3Uri);
    const pageCount = estimatePageCount(docBuffer);

    // Convert office documents to get text for LLM processing
    if (isOfficeFormat(fileName)) {
      const converted = await convertOfficeDocument(docBuffer, fileName);
      // For office files, we still pass the original buffer but adapters handle conversion
      docBuffer = Buffer.from(converted.text.substring(0, 8000));
    }

    const input: AdapterInput = {
      documentBuffer: docBuffer,
      s3Uri: body.s3Uri,
      fileName,
      capabilities: body.capabilities,
      pageCount,
      userInstruction: body.userInstruction,
      // Preview is a side-by-side "quick look", so the cap only guards against a
      // runaway holding up the parallel comparison. It scales with the document
      // so a 30-page report is not truncated mid-table.
      maxOutputTokens: previewOutputCap(body.capabilities.length, pageCount),
    };

    const methods = getAvailableMethods(body.methods);

    // Availability (config + format + language + capability rules) lives in one
    // shared service so /preview, /pipeline and /process cannot disagree about
    // whether a method is runnable.
    const ext = fileName.match(/\.(\w+)$/)?.[1] ?? '';
    const documentLanguages = body.documentLanguages ?? [];
    const availabilityCtx = {
      extension: ext,
      languages: documentLanguages,
      capabilities: body.capabilities,
      hasProcessor: (m: ProcessingMethod) => !!PROCESSOR_FACTORY[m],
    };

    const validMethods = methods.filter(
      (m) => getMethodAvailability(m, availabilityCtx).available,
    );

    const userAlias = (req as any).authUser?.alias ?? 'anonymous';
    const runId = randomUUID();
    const previewStart = Date.now();
    console.log(`[Preview] docId=${body.documentId} runId=${runId} pages=${pageCount} caps=${body.capabilities.join(',')} methods=${validMethods.join(',')}`);
    trackActivity(userAlias, 'preview_start', {
      documentId: body.documentId,
      s3Uri: body.s3Uri,
      details: { capabilities: body.capabilities, methods: validMethods },
    });

    // SSE streaming: emit each method result as it completes
    initSSE(res);
    const keepalive = startKeepalive(res);

    // Collect results for run tracking. Typed (was `unknown[]`) so the script
    // detection below can read each result's extracted text without a cast.
    const collectedResults: ProcessorResult[] = [];

    // Emit method list upfront
    emitSSE(res, {
      type: 'preview_start',
      runId,
      documentId: body.documentId,
      capabilities: body.capabilities,
      methods: validMethods.map((m) => ({
        method: m,
        shortName: METHOD_INFO[m].shortName,
        family: METHOD_INFO[m].family,
        tokenPricing: METHOD_INFO[m].tokenPricing,
      })),
    });

    // Run all processors in parallel, emit results as they complete.
    // Pass `res` so adapters can stream method_progress events (token deltas,
    // BDA polling status) — without these the SSE connection can go idle for
    // minutes on slow methods and intermediaries (CloudFront, ALB) drop it.
    await Promise.allSettled(
      validMethods.map(async (method) => {
        const methodStart = Date.now();
        try {
          const processor = PROCESSOR_FACTORY[method]!();
          // Bound each method independently. Preview is a "quick look" that the
          // user waits on with every method racing in parallel, so total wall
          // clock is the SLOWEST method. Without a cap, one model that runs
          // away generating until it hits the output ceiling holds the whole
          // run: a real document once pushed Nova 2 Lite to 161s (16.6k output
          // tokens, i.e. the token ceiling) when it normally answers in ~5s.
          // A timed-out method reports as an error instead of stalling the rest.
          const result = await withTimeout(
            processor.process(res, input),
            PREVIEW_METHOD_TIMEOUT_MS,
            method,
          );
          const info = METHOD_INFO[method];
          console.log(`[Preview] ${method} ${result.status} ${Date.now() - methodStart}ms cost=$${result.metrics.cost.toFixed(4)}`);
          const methodResult = {
            method,
            status: result.status,
            results: result.results,
            metrics: result.metrics,
            rawOutput: result.rawOutput,
            ...(result.error ? { error: result.error } : {}),
          };
          collectedResults.push(methodResult);
          emitSSE(res, {
            type: 'method_result',
            method,
            shortName: info.shortName,
            family: info.family,
            status: result.status,
            results: result.results,
            rawOutput: result.rawOutput,
            latencyMs: result.metrics.latencyMs,
            estimatedCost: result.metrics.cost,
            confidence: result.metrics.confidence,
            // Measured OCR confidence for two-stage methods — the only
            // non-self-reported confidence figure available.
            ocrConfidence: result.metrics.ocrConfidence,
            tokenUsage: result.metrics.tokenUsage,
            // The model hit its output ceiling, so this result is a fragment. Sent so
            // the UI can say so — a truncated table otherwise looks complete.
            ...(result.truncated ? { truncated: true } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
        } catch (err) {
          const info = METHOD_INFO[method];
          const msg = (err as Error)?.message ?? 'Unknown error';
          console.error(`[Preview] ${method} threw after ${Date.now() - methodStart}ms:`, msg);
          emitSSE(res, {
            type: 'method_result',
            method,
            shortName: info.shortName,
            family: info.family,
            status: 'error',
            results: {},
            latencyMs: 0,
            error: msg,
          });
        }
      }),
    );

    console.log(`[Preview] docId=${body.documentId} completed ${validMethods.length} methods in ${Date.now() - previewStart}ms`);

    /*
     * Detect the document's script from what the models actually read, and tell the
     * client — so pipeline routing can exclude the families that cannot handle it
     * even when the advisor interview never ran.
     *
     * Why here and not at upload: this is the first point where the document's text
     * exists without paying for a separate extraction. Preview deliberately still
     * runs EVERY method — watching BDA score 32% on a Korean page next to Claude's
     * 100% is the comparison this product exists to show. It is step 3 (build a
     * pipeline you would deploy) that must not silently pick a 32% method.
     *
     * Measured on a real Korean quotation: every BDA method recovered 32% of known
     * content and every Textract hybrid 37-42%, versus 100% for the Claude and GPT
     * tiers — and two of them reported 87-93% self-confidence while doing it.
     * `isMethodLanguageCompatible` already encodes exactly this exclusion; it was
     * simply never given the input.
     */
    const detected = detectScripts(
      collectedResults.map((r) => extractUpstreamText(r)).join('\n'),
    );
    // A caller-supplied language (from the interview) is authoritative — the user
    // may know something the sample does not show.
    const effectiveLanguages = documentLanguages.length > 0
      ? documentLanguages
      : detected.languages;

    if (documentLanguages.length === 0 && detected.scripts.length > 0) {
      emitSSE(res, {
        type: 'languages_detected',
        data: {
          languages: detected.languages,
          scripts: detected.scripts,
          nonLatinRatio: detected.nonLatinRatio,
        },
      } as never);
      console.log(
        `[Preview] detected script(s) ${detected.scripts.join('/')} `
        + `(${Math.round(detected.nonLatinRatio * 100)}% non-Latin) -> languages ${detected.languages.join(',')}`,
      );
    }

    // Save run results for the "Recent Runs" feature (non-blocking)
    const ext2 = (fileName.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase();
    trackRunResults(userAlias, {
      runId,
      documentId: body.documentId,
      documentName: fileName,
      s3Uri: body.s3Uri,
      capabilities: body.capabilities,
      methods: validMethods,
      results: collectedResults,
      comparison: null, // Preview does not produce a comparison
      source: 'preview',
      status: collectedResults.length > 0 ? 'complete' : 'error',
      fileSize: docBuffer.length,
      pageCount,
      fileType: ext2 || undefined,
      documentLanguages: effectiveLanguages.length > 0 ? effectiveLanguages : undefined,
    });

    emitSSE(res, { type: 'preview_done', runId });
    endSSE(res, keepalive);
  } catch (err) {
    console.error('[Preview Error]', err);
    // If SSE already started, emit error event; otherwise send JSON error
    if (res.headersSent) {
      emitSSE(res, { type: 'preview_error', error: err instanceof Error ? err.message : 'Preview failed' });
      res.end();
    } else {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Preview failed' });
    }
  }
});

export default router;

/** Test-only: lets processor-registry-parity.test.ts compare the three route
 * registries so they can never silently drift again. */
export const PROCESSOR_FACTORY_FOR_TEST = PROCESSOR_FACTORY;

/** Test-only: the preview output cap is latency-critical, so it needs coverage. */
export { previewOutputCap as previewOutputCapForTest };
