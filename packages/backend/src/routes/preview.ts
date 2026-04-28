import { Router } from 'express';
import type { Capability, ProcessingMethod } from '@idp/shared';
import { getBestMethodsForCapability, METHOD_INFO, BDA_LIMITS, TEXTRACT_LIMITS, isMethodLanguageCompatible } from '@idp/shared';
import { getDocumentBuffer } from '../services/s3.js';
import { convertOfficeDocument, isOfficeFormat } from '../services/file-converter.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';
import { ProcessorBase } from '../processors/processor-base.js';
import { BdaStandardProcessor } from '../processors/bda-processor.js';
import { BdaClaudeSonnetProcessor, BdaClaudeHaikuProcessor, BdaNovaLiteProcessor } from '../processors/bda-llm.js';
import { ClaudeSonnetProcessor, ClaudeHaikuProcessor, ClaudeOpusProcessor } from '../processors/claude-direct.js';
import { NovaLiteProcessor, NovaProProcessor } from '../processors/nova-direct.js';
import { TextractClaudeSonnetProcessor, TextractClaudeHaikuProcessor, TextractNovaLiteProcessor, TextractNovaProProcessor } from '../processors/textract-llm.js';
import { BedrockGuardrailsProcessor } from '../processors/guardrails.js';
import { config } from '../config/aws.js';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { trackActivity, trackRunResults } from '../services/activity-tracker.js';
import { randomUUID } from 'crypto';

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
  'bda-claude-sonnet': () => new BdaClaudeSonnetProcessor(),
  'bda-claude-haiku': () => new BdaClaudeHaikuProcessor(),
  'bda-nova-lite': () => new BdaNovaLiteProcessor(),
  'claude-sonnet': () => new ClaudeSonnetProcessor(),
  'claude-haiku': () => new ClaudeHaikuProcessor(),
  'claude-opus': () => new ClaudeOpusProcessor(),
  'nova-lite': () => new NovaLiteProcessor(),
  'nova-pro': () => new NovaProProcessor(),
  'textract-claude-sonnet': () => new TextractClaudeSonnetProcessor(),
  'textract-claude-haiku': () => new TextractClaudeHaikuProcessor(),
  'textract-nova-lite': () => new TextractNovaLiteProcessor(),
  'textract-nova-pro': () => new TextractNovaProProcessor(),
  'bedrock-guardrails': () => new BedrockGuardrailsProcessor(),
};

function estimatePageCount(buffer: Buffer): number {
  const content = buffer.toString('binary');
  const matches = content.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 1;
}

const router = Router();

router.post('/', async (req, res) => {
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
    };

    const methods = getAvailableMethods(body.methods);

    // Filter out methods without configured backends or incompatible document formats.
    // Uses the canonical format lists from @idp/shared (BDA_LIMITS, TEXTRACT_LIMITS).
    const ext = (fileName.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase();
    const normalizedExt = ext === 'jpg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext;
    const isBdaCompatible = (BDA_LIMITS.async.supportedFormats as readonly string[]).includes(normalizedExt);
    const isTextractCompatible = (TEXTRACT_LIMITS.analyzeDocument.supportedFormats as readonly string[]).includes(normalizedExt);

    const documentLanguages = body.documentLanguages ?? [];

    const hasPiiCapability = body.capabilities.some((c) => c === 'pii_detection' || c === 'pii_redaction');

    const validMethods = methods.filter((m) => {
      if (m.startsWith('bda-') && m !== 'bda-custom' && !config.bdaProfileArn) return false;
      if (m.startsWith('bda-') && !isBdaCompatible) return false;
      if (m === 'bda-custom' && !config.bdaProjectArn) return false;
      if (m.startsWith('textract-') && !isTextractCompatible) return false;
      if (m === 'bedrock-guardrails') {
        // Only include Guardrails when BEDROCK_GUARDRAIL_ID is set, at least one
        // PII capability is requested, and Textract supports the file format.
        if (!config.bedrockGuardrailId) return false;
        if (!hasPiiCapability) return false;
        if (!isTextractCompatible) return false;
      }
      if (documentLanguages.length && !isMethodLanguageCompatible(m, documentLanguages)) return false;
      return !!PROCESSOR_FACTORY[m];
    });

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

    // Collect results for run tracking
    const collectedResults: unknown[] = [];

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
          const result = await processor.process(res, input);
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
            tokenUsage: result.metrics.tokenUsage,
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
      documentLanguages: documentLanguages.length > 0 ? documentLanguages : undefined,
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
