import { Router } from 'express';
import type { Capability, ProcessingMethod } from '@idp/shared';
import { getBestMethodsForCapability, METHOD_INFO, BDA_LIMITS, TEXTRACT_LIMITS } from '@idp/shared';
import { getDocumentBuffer } from '../services/s3.js';
import { convertOfficeDocument, isOfficeFormat } from '../services/file-converter.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';
import { ProcessorBase } from '../processors/processor-base.js';
import { BdaStandardProcessor } from '../processors/bda-processor.js';
import { BdaClaudeSonnetProcessor, BdaClaudeHaikuProcessor, BdaNovaLiteProcessor } from '../processors/bda-llm.js';
import { ClaudeSonnetProcessor, ClaudeHaikuProcessor } from '../processors/claude-direct.js';
import { NovaLiteProcessor } from '../processors/nova-direct.js';
import { TextractClaudeHaikuProcessor } from '../processors/textract-llm.js';
import { config } from '../config/aws.js';

interface PreviewRequest {
  documentId: string;
  s3Uri: string;
  capabilities: Capability[];
  methods?: ProcessingMethod[];
  userInstruction?: string;
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
  'nova-lite': () => new NovaLiteProcessor(),
  'textract-claude-haiku': () => new TextractClaudeHaikuProcessor(),
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

    const validMethods = methods.filter((m) => {
      if (m.startsWith('bda-') && m !== 'bda-custom' && !config.bdaProfileArn) return false;
      if (m.startsWith('bda-') && !isBdaCompatible) return false;
      if (m === 'bda-custom' && !config.bdaProjectArn) return false;
      if (m.startsWith('textract-') && !isTextractCompatible) return false;
      return !!PROCESSOR_FACTORY[m];
    });

    // Run all processors in parallel with null response (no SSE)
    const settled = await Promise.allSettled(
      validMethods.map(async (method) => {
        const processor = PROCESSOR_FACTORY[method]!();
        const result = await processor.process(null, input);
        return { method, result };
      }),
    );

    const results = settled.map((s, i) => {
      if (s.status === 'fulfilled') {
        const { method, result } = s.value;
        const info = METHOD_INFO[method];
        return {
          method,
          shortName: info.shortName,
          family: info.family,
          status: result.status,
          results: result.results,
          rawOutput: result.rawOutput,
          latencyMs: result.metrics.latencyMs,
          estimatedCost: result.metrics.cost,
          confidence: result.metrics.confidence,
          ...(result.error ? { error: result.error } : {}),
        };
      }
      const method = validMethods[i];
      const info = METHOD_INFO[method];
      return {
        method,
        shortName: info.shortName,
        family: info.family,
        status: 'error' as const,
        results: {},
        latencyMs: 0,
        error: (s.reason as Error)?.message ?? 'Unknown error',
      };
    });

    res.json({
      documentId: body.documentId,
      capabilities: body.capabilities,
      methods: validMethods.map((m) => ({
        method: m,
        shortName: METHOD_INFO[m].shortName,
        family: METHOD_INFO[m].family,
        tokenPricing: METHOD_INFO[m].tokenPricing,
      })),
      results,
    });
  } catch (err) {
    console.error('[Preview Error]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Preview failed' });
  }
});

export default router;
