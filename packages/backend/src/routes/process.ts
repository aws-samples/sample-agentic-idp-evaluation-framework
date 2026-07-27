import { Router } from 'express';
import type { ProcessRequest, ProcessingMethod, ProcessorResult } from '@idp/shared';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { getDocumentBuffer } from '../services/s3.js';
import { buildComparison } from '../services/comparison.js';
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
import { validateBody } from '../middleware/validate-body.js';

const PROCESSOR_MAP: Partial<Record<ProcessingMethod, () => ProcessorBase>> & Record<string, () => ProcessorBase> = {
  'bda-standard': () => new BdaStandardProcessor(),
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

const router = Router();

router.post('/', validateBody({ documentId: 'string', s3Uri: 'string', capabilities: 'array' }), async (req, res) => {
  const body = req.body as ProcessRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const documentBuffer = await getDocumentBuffer(body.s3Uri);
    const pageCount = estimatePageCount(documentBuffer);
    const fileName = body.s3Uri.split('/').pop() ?? 'document.pdf';

    const input: AdapterInput = {
      documentBuffer,
      s3Uri: body.s3Uri,
      fileName,
      capabilities: body.capabilities,
      pageCount,
    };

    // Availability rules come from the shared service so /preview, /pipeline and
    // /process all agree on whether a method can run.
    const ext = fileName.match(/\.(\w+)$/)?.[1] ?? '';
    const documentLanguages: string[] = (body as any).documentLanguages ?? [];

    const methods = body.methods.filter((m) => {
      const availability = getMethodAvailability(m, {
        extension: ext,
        languages: documentLanguages,
        capabilities: body.capabilities,
        hasProcessor: (method) => !!PROCESSOR_MAP[method],
      });
      if (!availability.available) {
        emitSSE(res, {
          type: 'method_error',
          method: m,
          error: availability.detail ?? `${m} is unavailable`,
        });
        return false;
      }
      return true;
    });

    // Run all processors in parallel
    const processorPromises = methods
      .filter((method) => PROCESSOR_MAP[method]) // skip methods without processors (e.g. embeddings)
      .map(async (method) => {
        const processor = PROCESSOR_MAP[method]!();
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

/** Test-only: lets processor-registry-parity.test.ts compare the three route
 * registries so they can never silently drift again. */
export const PROCESSOR_MAP_FOR_TEST = PROCESSOR_MAP;
