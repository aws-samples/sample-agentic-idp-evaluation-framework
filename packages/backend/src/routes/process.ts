import { Router } from 'express';
import type { ProcessRequest, ProcessingMethod, ProcessorResult } from '@idp/shared';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { getDocumentBuffer } from '../services/s3.js';
import { buildComparison } from '../services/comparison.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';
import { ProcessorBase } from '../processors/processor-base.js';
import { BdaStandardProcessor, BdaCustomProcessor } from '../processors/bda-processor.js';
import { ClaudeSonnetProcessor, ClaudeHaikuProcessor, ClaudeOpusProcessor } from '../processors/claude-direct.js';
import { NovaLiteProcessor, NovaProProcessor } from '../processors/nova-direct.js';
import { TextractClaudeSonnetProcessor, TextractClaudeHaikuProcessor, TextractNovaLiteProcessor, TextractNovaProProcessor } from '../processors/textract-llm.js';
import { config } from '../config/aws.js';

const PROCESSOR_MAP: Record<ProcessingMethod, () => ProcessorBase> = {
  'bda-standard': () => new BdaStandardProcessor(),
  'bda-custom': () => new BdaCustomProcessor(),
  'claude-sonnet': () => new ClaudeSonnetProcessor(),
  'claude-haiku': () => new ClaudeHaikuProcessor(),
  'claude-opus': () => new ClaudeOpusProcessor(),
  'nova-lite': () => new NovaLiteProcessor(),
  'nova-pro': () => new NovaProProcessor(),
  'textract-claude-sonnet': () => new TextractClaudeSonnetProcessor(),
  'textract-claude-haiku': () => new TextractClaudeHaikuProcessor(),
  'textract-nova-lite': () => new TextractNovaLiteProcessor(),
  'textract-nova-pro': () => new TextractNovaProProcessor(),
};

function estimatePageCount(buffer: Buffer): number {
  const content = buffer.toString('binary');
  const matches = content.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 1;
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as ProcessRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const documentBuffer = await getDocumentBuffer(body.s3Uri);
    const pageCount = estimatePageCount(documentBuffer);

    const input: AdapterInput = {
      documentBuffer,
      s3Uri: body.s3Uri,
      capabilities: body.capabilities,
      pageCount,
    };

    // Filter methods: skip bda-custom if no project ARN
    const methods = body.methods.filter((m) => {
      if (m === 'bda-custom' && !config.bdaProjectArn) {
        emitSSE(res, {
          type: 'method_error',
          method: m,
          error: 'BDA Custom Blueprint not configured (BDA_PROJECT_ARN is empty)',
        });
        return false;
      }
      return true;
    });

    // Run all processors in parallel
    const processorPromises = methods.map(async (method) => {
      const processor = PROCESSOR_MAP[method]();
      return processor.process(res, input);
    });

    const settledResults = await Promise.allSettled(processorPromises);

    const completedResults: ProcessorResult[] = [];
    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        completedResults.push(settled.value);
      }
    }

    // Build and emit comparison after each result
    if (completedResults.length > 0) {
      const comparison = buildComparison(completedResults);
      emitSSE(res, { type: 'comparison_update', data: comparison });

      emitSSE(res, {
        type: 'all_complete',
        data: {
          results: completedResults,
          comparison,
        },
      });
    }
  } catch (err) {
    console.error('[Process Error]', err);
    emitSSE(res, {
      type: 'method_error',
      method: body.methods[0],
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  } finally {
    endSSE(res, keepalive);
  }
});

export default router;
