import { Router } from 'express';
import type { Capability, ProcessingMethod } from '@idp/shared';
import { getBestMethodsForCapability, METHOD_INFO } from '@idp/shared';
import { getDocumentBuffer } from '../services/s3.js';
import { convertOfficeDocument, isOfficeFormat } from '../services/file-converter.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';
import { ProcessorBase } from '../processors/processor-base.js';
import { BdaStandardProcessor } from '../processors/bda-processor.js';
import { ClaudeSonnetProcessor, ClaudeHaikuProcessor } from '../processors/claude-direct.js';
import { NovaLiteProcessor } from '../processors/nova-direct.js';
import { TextractClaudeHaikuProcessor } from '../processors/textract-llm.js';
import { config } from '../config/aws.js';

interface PreviewRequest {
  documentId: string;
  s3Uri: string;
  capabilities: Capability[];
  methods?: ProcessingMethod[];
}

// Default preview methods: 1 fast + 1 accurate + optionally BDA
function selectPreviewMethods(capabilities: Capability[], requestedMethods?: ProcessingMethod[]): ProcessingMethod[] {
  if (requestedMethods?.length) return requestedMethods;

  const methods: ProcessingMethod[] = ['claude-haiku', 'claude-sonnet'];

  const hasBdaCap = capabilities.some((cap) => {
    const best = getBestMethodsForCapability(cap);
    return best.length > 0 && METHOD_INFO[best[0]]?.family === 'bda';
  });

  if (hasBdaCap && config.bdaProfileArn) {
    methods.push('bda-standard');
  }

  return methods;
}

const PROCESSOR_FACTORY: Partial<Record<ProcessingMethod, () => ProcessorBase>> = {
  'bda-standard': () => new BdaStandardProcessor(),
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
    };

    const methods = selectPreviewMethods(body.capabilities, body.methods);

    // Filter out methods without configured backends or incompatible with local storage
    const isLocal = body.s3Uri.startsWith('local://');
    const validMethods = methods.filter((m) => {
      if (m === 'bda-standard' && (!config.bdaProfileArn || isLocal)) return false;
      if (m === 'bda-custom' && (!config.bdaProjectArn || isLocal)) return false;
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
